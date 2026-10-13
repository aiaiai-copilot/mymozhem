### Task 5: TokenService.rotate — ротация, reuse-detection, REQ-ID-016 проверки (integration)

**REQ:** REQ-ID-007 (ротация при каждом refresh; reuse → revoke семейства), REQ-ID-016 (инвалидация при терминальной комнате / TTL гостя / удалённой identity).

**Files:**
- Modify: `packages/core/src/auth/token.service.ts` (добавить `rotate`)
- Create: `packages/core/src/auth/token.service.int-spec.ts`

**Interfaces:**
- Consumes: `RoomService.create`, `MembershipService.join` (для посева гостя+членства), `seedIdentity`, `startTestDb`, `TEST_CONFIG`.
- Produces: `TokenService.rotate(refreshToken: string): Promise<IssuedTokens>`.

**Design-решения в коде (дизайн §4):**
- Гостевая сессия ↔ единственное членство гостя: `roomId` для новых claims берётся из членства identity (у гостя ровно одно). REGISTERED-ветка (не используется в срезе) пропускает room-проверки.
- Гонка двух параллельных refresh: conditional `updateMany` (`replacedById: null AND revokedAt: null AND expiresAt > now`) — побеждает один; проигравший получает `SESSION_INVALID`, семейство НЕ ревокается (это не кража, а гонка).
- Повторное предъявление УЖЕ ротированного токена (`replacedById != null`) → `updateMany` revoke всего `familyId` → `SESSION_INVALID` (REQ-ID-007).
- `expiresAt` новой сессии — sliding (`now + min(REFRESH,GUEST_TTL)`); гостевой потолок всё равно сдержан TTL-проверкой identity.

- [ ] **Step 1: Падающий int-spec (token.service.int-spec.ts)**

Каркас по образцу `membership.service.int-spec.ts` (ручное конструирование, `startTestDb`, TRUNCATE в afterEach — добавить `identity."Session"` в список). Посев: `seedIdentity` (организатор) → `RoomService.create` → `MembershipService.join` → `TokenService.issueGuestTokens`. Тесты:
```ts
it('rotates: old refresh dies, new pair works, familyId preserved', async () => {
  const first = await tokens.issueGuestTokens(identity.id, room.id);
  const second = await tokens.rotate(first.refreshToken);
  expect(second.refreshToken).not.toBe(first.refreshToken);
  const claims = tokens.verifyAccessToken(second.accessToken);
  expect(claims).toMatchObject({ sub: identity.id, kind: 'GUEST', roomId: room.id });
  const sessions = await db.prisma.session.findMany({ where: { familyId: (await db.prisma.session.findFirstOrThrow())!.familyId } });
  expect(sessions).toHaveLength(2);
  await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(AuthError); // старый мёртв
});

it('reuse of an already-rotated token revokes the whole family (REQ-ID-007)', async () => {
  const first = await tokens.issueGuestTokens(identity.id, room.id);
  const second = await tokens.rotate(first.refreshToken);
  await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(AuthError); // reuse → revoke
  await expect(tokens.rotate(second.refreshToken)).rejects.toThrow(AuthError); // новый тоже мёртв
  const alive = await db.prisma.session.count({ where: { revokedAt: null } });
  expect(alive).toBe(0);
});

it('rejects an unknown refresh token', async () => {
  await expect(tokens.rotate('nope')).rejects.toThrow(AuthError);
});

it('rejects refresh when the room is COMPLETED (REQ-ID-016)', async () => {
  const first = await tokens.issueGuestTokens(identity.id, room.id);
  await roomService.complete(room.id); // DRAFT→ACTIVE→COMPLETED по стейт-машине: сначала activate
  await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(AuthError);
});

it('rejects refresh when guest TTL expired (REQ-ID-016)', async () => {
  const first = await tokens.issueGuestTokens(identity.id, room.id);
  await db.prisma.identity.update({ where: { id: identity.id }, data: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) } });
  await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(AuthError);
});

it('rejects refresh when identity is soft-deleted', async () => { /* deletedAt: new Date() → AuthError */ });

it('rejects refresh when session is expired', async () => {
  // expiresAt в прошлое напрямую в БД → AuthError
});

it('only one of two concurrent rotations wins; family NOT revoked on race', async () => {
  const first = await tokens.issueGuestTokens(identity.id, room.id);
  const results = await Promise.allSettled([tokens.rotate(first.refreshToken), tokens.rotate(first.refreshToken)]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  expect(ok).toHaveLength(1);
  const alive = await db.prisma.session.count({ where: { revokedAt: null } });
  expect(alive).toBe(1); // семейство живо, победитель может продолжать
});
```
*Комната для `complete` должна быть ACTIVE: `await roomService.activate(room.id)` затем `complete`. Проверить сигнатуры переходов в room.service.ts — если `activate/complete` требуют configure (ROOM_NOT_CONFIGURED), посев упрощается: терминальность достигается через `cancel` (DRAFT→CANCELLED) — выбрать по факту сигнатур.*

- [ ] **Step 2: Прогнать — падает** (`pnpm --filter @mymozhem/core test:int -t "TokenService.rotate"`, ожидаемо: `rotate is not a function`)

- [ ] **Step 3: Реализация rotate в token.service.ts**

```ts
  // Ротация (REQ-ID-007) + проверки жизни гостевой сессии (REQ-ID-016). Все отказные
  // ветки — один SESSION_INVALID наружу; различие только в server-side message.
  async rotate(refreshToken: string): Promise<IssuedTokens> {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
    });
    if (!session) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'unknown refresh token');
    }
    if (session.replacedById !== null) {
      // Предъявлен уже ротированный токен — сигнал кражи: гасим всё семейство (REQ-ID-007).
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, `refresh reuse detected, family ${session.familyId} revoked`);
    }
    if (session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'session revoked or expired');
    }

    const identity = await this.prisma.identity.findUnique({ where: { id: session.identityId } });
    if (!identity || identity.deletedAt !== null) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'identity gone');
    }

    let roomId: string | undefined;
    if (identity.kind === 'GUEST') {
      if (identity.createdAt.getTime() + this.config.GUEST_TTL * 1000 <= Date.now()) {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'guest TTL expired');
      }
      // Гость живёт ровно в одной комнате — членство и есть scope сессии (design §4).
      const membership = await this.prisma.membership.findFirst({ where: { identityId: identity.id } });
      if (!membership) {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'membership gone');
      }
      const room = await this.prisma.room.findUnique({ where: { id: membership.roomId } });
      if (!room || room.status === 'COMPLETED' || room.status === 'CANCELLED' || room.deletedAt !== null) {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'room terminal');
      }
      roomId = membership.roomId;
    }

    const newRefreshToken = randomBytes(32).toString('base64url');
    const newSessionId = randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        // Атомарный захват ротации: проигравший гонку видит count=0 → SESSION_INVALID,
        // семейство НЕ ревокается (гонка ≠ кража, design §4).
        const claimed = await tx.session.updateMany({
          where: { id: session.id, replacedById: null, revokedAt: null, expiresAt: { gt: new Date() } },
          data: { replacedById: newSessionId },
        });
        if (claimed.count === 0) {
          throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'rotation race lost');
        }
        await tx.session.create({
          data: {
            id: newSessionId,
            identityId: session.identityId,
            refreshTokenHash: sha256(newRefreshToken),
            familyId: session.familyId,
            expiresAt: this.sessionExpiry(),
          },
        });
      });
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, `rotation failed: ${(err as Error).message}`);
    }

    return {
      accessToken: this.signAccess({ sub: identity.id, sid: newSessionId, kind: identity.kind, roomId }),
      expiresIn: this.config.ACCESS_TOKEN_TTL,
      refreshToken: newRefreshToken,
    };
  }
```

- [ ] **Step 4: Прогнать int — зелёно; вся int-лана core — зелёно** (`pnpm --filter @mymozhem/core test:int`)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth
git commit -m "feat(core): refresh rotation with reuse detection and REQ-ID-016 invalidation"
```

---

