# Срез исключения (membership removal) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исключение участника организатором: soft-delete membership, rejoin-блок по IP, отзыв guest-сессий, немедленный разрыв realtime-подписок через hook — полный путь REQ-SEC-003 от REST до сокета.

**Architecture:** Новая миграция (`Membership.deletedAt/joinIp` + таблица `Exclusion`) → `MembershipService.exclude` с пост-коммит hook-реестром (паттерн RealtimeBus: realtime-модуль подписывает `RealtimeGateway.revokeRoomAccess`, зависимость однонаправленная) → endpoint `POST /rooms/:roomId/members/:identityId/exclude` (актор только из access JWT) → rejoin-ветка в `join` → фикс M-3 в subscribe. Дизайн: `docs/sessions/2026-08-18-membership-exclusion-design.md` — §0 решения владельца не переоткрывать.

**Tech Stack:** NestJS 11 (Fastify), Prisma 7.8 (adapter-pg, multiSchema), zod v4 SDK-контракт, Socket.io, jest + testcontainers (postgres:17).

**Закрываемые REQ-\* (сверка первой стадии ревью):** REQ-SEC-003 (полный путь отзыва), REQ-ID-006 ч.3 (частично — только IP, device-cookie осознанно отложен, дизайн §0.1), REQ-ID-011 ч. (матрица: исключение только ORGANIZER), REQ-ID-013 (rejoin-блок свёрнут в ROOM_JOIN_DENIED), REQ-SEC-006 (наружу ровно `{code}`), REQ-RT-009 по духу HTTP (actorId из токена), REQ-CTR-004/005 (контракт 1.3.0 аддитивно + фикстуры).

**Уточнение к дизайну §2 (требует санкции владельца при старте исполнения):** `Membership.joinIp` делается **nullable** (`String?`), не NOT NULL. Причина: `RoomService.createOrganizerMembership` создаёт ORGANIZER-membership без IP-контекста (нет HTTP-запроса); организатор неисключаем (дизайн §0.4), поэтому его `joinIp = null` никогда не попадёт в `Exclusion`. Инвариант «у не-ORGANIZER membership joinIp не-null» принуждается guard'ом в `exclude` (Task 4).

## Global Constraints

- **Замороженные миграции не трогаем** — только новая миграция (HANDOFF, долгоживущие ограничения).
- **zod v4:** `z.uuid()` требует валидный RFC 9562 version nibble — в новых тестах только v4-совместимые UUID (прецедент: `00000000-0000-4000-8000-000000000001`).
- **Порядок сборки:** core резолвит `@mymozhem/sdk` из dist — после правок SDK обязателен `pnpm --filter @mymozhem/sdk build` перед тестами core; apps/server e2e резолвит `@mymozhem/core` из dist — перед `pnpm --filter @mymozhem/server test` обязателен `pnpm build` в корне.
- **Int/e2e поднимают контейнеры Postgres** — Docker Desktop должен быть запущен; хост-порт 5432 занят чужим контейнером `lt-pg` (не трогать).
- **Jest CLI:** рабочая форма `pnpm --filter @mymozhem/core test:int -t "..."` — БЕЗ `--`; фильтр проверять на >0 матчей.
- **Контроллеры статусов не знают** — маппинг ошибка→HTTP только в `HttpExceptionFilter`; наружу ровно `{code}` (REQ-SEC-006).
- **Conventional commits** в стиле репозитория (`feat(core): …`, `test(server): …`, …), Co-Authored-By трейлер.
- **После каждого таска** — коммит; красный CI-гейт чинится в том же таске.

---

### Task 1: SDK — коды ошибок, exclusion DTO, контракт 1.3.0

**Files:**
- Modify: `packages/sdk/src/errors/error-codes.ts`
- Modify: `packages/sdk/src/errors/error-codes.contract.spec.ts`
- Create: `packages/sdk/src/membership/exclude-request.ts`
- Create: `packages/sdk/src/membership/exclude-request.fixtures.ts`
- Create: `packages/sdk/src/membership/exclude-request.contract.spec.ts`
- Create: `packages/sdk/src/membership/exclude-response.ts`
- Create: `packages/sdk/src/membership/exclude-response.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/src/contract-version.ts` (`CONTRACT_VERSION = '1.3.0'`)
- Modify: `packages/sdk/package.json` (`"version": "1.3.0"`)

**Interfaces:**
- Produces: `excludeRequestSchema` (`z.strictObject({ reason?: string })`), тип `ExcludeRequest`; `excludeResponseSchema` (`z.strictObject({ excluded: boolean })`), тип `ExcludeResponse`; новые `ContractErrorCode`: `ACTOR_NOT_ORGANIZER`, `TARGET_NOT_MEMBER`, `TARGET_NOT_EXCLUDABLE`; `CONTRACT_VERSION = '1.3.0'`. Потребители: ExcludeController (Task 7), e2e (Task 8).

- [ ] **Step 1: Падающий контрактный спек кодов**

Modify `packages/sdk/src/errors/error-codes.contract.spec.ts` — добавить три кода в ожидаемый список (спек держит точный упорядоченный перечень; новые коды — после `ACTOR_NOT_MEMBER`, в блок membership-действий):

```ts
      'ACTOR_NOT_MEMBER',
      'ACTOR_NOT_ORGANIZER',
      'TARGET_NOT_MEMBER',
      'TARGET_NOT_EXCLUDABLE',
      'ROOM_JOIN_DENIED',
```

- [ ] **Step 2: Падающие контрактные спеки DTO**

Create `packages/sdk/src/membership/exclude-request.contract.spec.ts`:

```ts
import { excludeRequestSchema } from './exclude-request';
import { validExcludeRequests, invalidExcludeRequests } from './exclude-request.fixtures';

describe('excludeRequest contract (REQ-ID-006)', () => {
  it.each(validExcludeRequests.map((v) => [JSON.stringify(v), v] as const))('accepts %s', (_l, v) => {
    expect(excludeRequestSchema.safeParse(v).success).toBe(true);
  });
  it.each(invalidExcludeRequests.map((v) => [JSON.stringify(v), v] as const))('rejects %s', (_l, v) => {
    expect(excludeRequestSchema.safeParse(v).success).toBe(false);
  });
});
```

Create `packages/sdk/src/membership/exclude-response.contract.spec.ts`:

```ts
import { excludeResponseSchema } from './exclude-response';

describe('excludeResponse contract (REQ-ID-006)', () => {
  it.each([{ excluded: true }, { excluded: false }])('accepts %j', (v) => {
    expect(excludeResponseSchema.safeParse(v).success).toBe(true);
  });
  it.each([{}, { excluded: 'yes' }, { excluded: true, extra: 1 }, 'x'])('rejects %j', (v) => {
    expect(excludeResponseSchema.safeParse(v).success).toBe(false);
  });
});
```

- [ ] **Step 3: Прогон — убедиться, что падают**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: FAIL (cannot find module './exclude-request' и т.п.; коды не совпали).

- [ ] **Step 4: Реализация**

Modify `packages/sdk/src/errors/error-codes.ts` — в `CONTRACT_ERROR_CODES` после `'ACTOR_NOT_MEMBER',` вставить:

```ts
  // Membership exclusion (срез исключения, REQ-ID-006): отказы endpoint'а exclude.
  'ACTOR_NOT_ORGANIZER',
  'TARGET_NOT_MEMBER',
  'TARGET_NOT_EXCLUDABLE',
```

Create `packages/sdk/src/membership/exclude-request.ts`:

```ts
import { z } from 'zod';

// POST /rooms/:roomId/members/:identityId/exclude (REQ-ID-006). strict: лишние ключи
// не проходят границу. reason — опциональное основание (задел под аудит REQ-ID-018,
// ф.4: там оно станет обязательным для MODERATOR).
export const excludeRequestSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500).optional(),
});
export type ExcludeRequest = z.infer<typeof excludeRequestSchema>;
```

Create `packages/sdk/src/membership/exclude-request.fixtures.ts`:

```ts
export const validExcludeRequests: unknown[] = [{}, { reason: 'нарушение правил' }, { reason: '  x  ' }];
export const invalidExcludeRequests: unknown[] = [
  { reason: '' },
  { reason: 'x'.repeat(501) },
  { reason: 42 },
  { reason: 'ok', extra: true }, // strictObject
  'not-an-object',
];
```

Create `packages/sdk/src/membership/exclude-response.ts`:

```ts
import { z } from 'zod';

// Ответ exclude (REQ-ID-006). excluded:false — типизированный no-op повторного
// исключения (дизайн §0.4, прецедент идемпотентности REQ-RWD-007).
export const excludeResponseSchema = z.strictObject({
  excluded: z.boolean(),
});
export type ExcludeResponse = z.infer<typeof excludeResponseSchema>;
```

Modify `packages/sdk/src/index.ts` — после строки `export * from './membership/room-join-policy.fixtures';` добавить:

```ts
export * from './membership/exclude-request';
export * from './membership/exclude-request.fixtures';
export * from './membership/exclude-response';
```

Modify `packages/sdk/src/contract-version.ts`: `export const CONTRACT_VERSION = '1.3.0';` (комментарий над константой оставить; minor-бамп — аддитивное расширение, REQ-CTR-004).

Modify `packages/sdk/package.json`: `"version": "1.3.0"` (спек `contract-version.contract.spec.ts` принуждает равенство — одно без другого красное).

- [ ] **Step 5: Прогон — зелёные**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: PASS (все спеки, включая version-sync).

- [ ] **Step 6: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): exclusion DTO + коды ACTOR_NOT_ORGANIZER/TARGET_NOT_MEMBER/TARGET_NOT_EXCLUDABLE, контракт 1.3.0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Prisma — миграция membership_exclusion

**Files:**
- Modify: `packages/core/prisma/schema.prisma` (model Membership + model Exclusion; relation-поля в Room и Identity)
- Create: `packages/core/prisma/migrations/<timestamp>_membership_exclusion/migration.sql` (генерируется)
- Modify: `packages/core/src/membership/membership-schema.int-spec.ts`

**Interfaces:**
- Produces: Prisma-клиент с `membership.deletedAt`, `membership.joinIp` (`string | null`), `prisma.exclusion` (`ip: string`, `excludedBy: string`, `reason: string | null`, `createdAt: Date`). Потребители: Tasks 3–5, 7, 8.

- [ ] **Step 1: Падающий schema int-spec (индексы Exclusion — автотест наличия, конвенция REQ-DEV-006)**

Modify `packages/core/src/membership/membership-schema.int-spec.ts` — добавить в конец `describe` (перед закрывающей скобкой):

```ts
  it('Exclusion: unique(roomId, identityId) и index(roomId, ip) существуют (REQ-ID-006)', async () => {
    const rows = await db.prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'membership' AND tablename = 'Exclusion'
    `;
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName.get('Exclusion_roomId_identityId_key')).toMatch(/^CREATE UNIQUE INDEX/);
    expect(byName.get('Exclusion_roomId_ip_idx')).toContain('"roomId"');
    expect(byName.get('Exclusion_roomId_ip_idx')).toContain('"ip"');
  });
```

- [ ] **Step 2: Прогон — убедиться, что падает**

Docker Desktop запущен. Run: `pnpm --filter @mymozhem/core test:int -t "Exclusion"`
Expected: FAIL (таблицы нет; проверить, что фильтр сматчил >0 тестов).

- [ ] **Step 3: Изменить schema.prisma**

Modify `packages/core/prisma/schema.prisma`:

1. В `model Room` добавить relation-поле (после `memberships  Membership[]`):

```prisma
  exclusions      Exclusion[]
```

2. В `model Identity` добавить два relation-поля (после `sessions    Session[]`):

```prisma
  exclusions  Exclusion[]  @relation("ExclusionTarget")
  exclusionsMade Exclusion[] @relation("ExclusionActor")
```

3. В `model Membership` добавить поля (после `joinedAt`):

```prisma
  deletedAt  DateTime?
  // IP на входе (REQ-ID-006 rejoin-блок). Nullable: ORGANIZER-membership создаётся
  // без IP-контекста (RoomService.create); организатор неисключаем, его joinIp
  // никогда не попадает в Exclusion (дизайн исключения §0.4).
  joinIp     String?
```

4. После `model Membership` добавить:

```prisma
// Exclusion — запись исключения участника (REQ-ID-006 ч.3) и одновременно
// аудит-запись (excludedBy + reason — задел под REQ-ID-018, ф.4). Очистка —
// регламентный job REQ-ID-010 (TTL-срез). device-cookie-признак появится
// аддитивно с cookie-инфраструктурой (дизайн исключения §0.1).
model Exclusion {
  id         String   @id @default(uuid()) @db.Uuid
  room       Room     @relation(fields: [roomId], references: [id], onDelete: Restrict)
  roomId     String   @db.Uuid
  identity   Identity @relation("ExclusionTarget", fields: [identityId], references: [id], onDelete: Restrict)
  identityId String   @db.Uuid
  ip         String
  excludedByIdentity Identity @relation("ExclusionActor", fields: [excludedBy], references: [id], onDelete: Restrict)
  excludedBy String   @db.Uuid
  reason     String?
  createdAt  DateTime @default(now())

  @@unique([roomId, identityId])
  @@index([roomId, ip])
  @@schema("membership")
}
```

- [ ] **Step 4: Авторинг миграции на эфемерном контейнере**

Хост-порт 5432 занят (`lt-pg`, не трогать) — авторинг-контейнер на свободном порту:

```bash
docker run --rm -d --name mm-migrate -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres -p 55432:5432 postgres:17
until docker exec mm-migrate pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
DATABASE_URL="postgresql://postgres:postgres@localhost:55432/postgres" pnpm --filter @mymozhem/core exec prisma migrate dev --name membership_exclusion
```

Затем явная регенерация клиента (migrate dev не всегда регенерирует; generate требует DATABASE_URL и cwd = корень репозитория):

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:55432/postgres" pnpm exec prisma generate
docker stop mm-migrate
```

Проверить сгенерированный SQL: новые колонки `Membership.deletedAt`/`joinIp` (nullable — без warning'а о непустой таблице), таблица `membership."Exclusion"`, уникальный индекс `Exclusion_roomId_identityId_key`, индекс `Exclusion_roomId_ip_idx`, FK с `ON DELETE RESTRICT`.

- [ ] **Step 5: Прогон — зелёный**

Run: `pnpm --filter @mymozhem/core test:int -t "Membership schema"`
Expected: PASS (включая новый тест индексов).

- [ ] **Step 6: Commit**

```bash
git add packages/core/prisma packages/core/src/membership/membership-schema.int-spec.ts
git commit -m "feat(core): миграция membership_exclusion — Membership.deletedAt/joinIp + таблица Exclusion (REQ-ID-006 ч.3, REQ-SEC-003)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: join хранит joinIp; findActiveMembership гасит soft-delete

**Files:**
- Modify: `packages/core/src/membership/membership.service.ts`
- Modify: `packages/core/src/membership/membership.service.int-spec.ts`

**Interfaces:**
- Consumes: `membership.joinIp`, `membership.deletedAt` (Task 2).
- Produces: `join` пишет `joinIp`; `findActiveMembership(roomId, identityId)` возвращает `null` при `deletedAt != null`. Потребители: Task 4 (exclude читает joinIp), realtime-гейты (уже вызывают findActiveMembership).

- [ ] **Step 1: Падающие int-спеки**

Modify `packages/core/src/membership/membership.service.int-spec.ts` — добавить в `describe('MembershipService.join ...')`:

```ts
  it('stores joinIp on the membership row (REQ-ID-006 rejoin-блок)', async () => {
    const room = await roomService.create(ORG);
    const result = await makeMembership().join({ code: room.code, displayName: 'Саша', ip: IP });
    const row = await db.prisma.membership.findUnique({ where: { id: result.membership.id } });
    expect(row?.joinIp).toBe(IP);
  });

  it('findActiveMembership returns null for a soft-deleted membership (REQ-SEC-003)', async () => {
    const room = await roomService.create(ORG);
    const result = await makeMembership().join({ code: room.code, displayName: 'Саша', ip: IP });
    // Soft-delete напрямую клиентом: публичный путь (exclude) — Task 4.
    await db.prisma.membership.update({
      where: { id: result.membership.id },
      data: { deletedAt: new Date() },
    });
    await expect(makeMembership().findActiveMembership(room.id, result.identity.id)).resolves.toBeNull();
  });
```

- [ ] **Step 2: Прогон — убедиться, что падают**

Run: `pnpm --filter @mymozhem/core test:int -t "joinIp|findActiveMembership returns null"`
Expected: FAIL (первый — `joinIp` равен null; второй — возвращается membership). Проверить >0 матчей.

- [ ] **Step 3: Реализация**

Modify `packages/core/src/membership/membership.service.ts`:

1. В `join`, в `tx.membership.create` добавить `joinIp: params.ip`:

```ts
      const membership = await tx.membership.create({
        data: { roomId: room.id, identityId: identity.id, joinIp: params.ip, role: 'PARTICIPANT' },
      });
```

2. В `findActiveMembership` заменить гасящее условие и снять комментарий-шов (строки 42–45: комментарий про «мягкого удаления самой membership в схеме пока нет»):

```ts
  // Read-path (REQ-SEC-003): живое членство в живой комнате. Мягкое удаление
  // комнаты И мягкое удаление самой membership (исключение, срез исключения)
  // гасят членство для чтения — проверка непрерывна, не единовременна.
  async findActiveMembership(roomId: string, identityId: string): Promise<Membership | null> {
    const membership = await this.prisma.membership.findUnique({
      where: { roomId_identityId: { roomId, identityId } },
      include: { room: true },
    });
    if (!membership || membership.deletedAt !== null || membership.room.deletedAt !== null) return null;
    return membership;
  }
```

- [ ] **Step 4: Прогон — зелёные + весь файл int-спеков не сломан**

Run: `pnpm --filter @mymozhem/core test:int -t "MembershipService"`
Expected: PASS (старые спеки включительно).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/membership/membership.service.ts packages/core/src/membership/membership.service.int-spec.ts
git commit -m "feat(core): join хранит joinIp; findActiveMembership гасит soft-deleted membership (REQ-SEC-003, REQ-ID-006)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: MembershipService.exclude + hook отзыва доступа

**Files:**
- Modify: `packages/core/src/membership/membership.errors.ts`
- Modify: `packages/core/src/membership/membership.service.ts`
- Modify: `packages/core/src/membership/membership.service.int-spec.ts`

**Interfaces:**
- Consumes: `membership.deletedAt/joinIp`, `prisma.exclusion` (Task 2–3).
- Produces:
  - `MembershipService.exclude(params: { roomId: string; targetIdentityId: string; actorId: string; reason?: string }): Promise<{ excluded: boolean }>`
  - `MembershipService.onAccessRevoked(handler: (identityId: string, roomId: string) => void): void`
  - Ошибки: `ActorNotMemberError`, `ActorNotOrganizerError`, `TargetNotMemberError`, `TargetNotExcludableError` (подклассы `MembershipError`, коды = одноимённые wire-коды из Task 1, кроме `ActorNotMemberError` → существующий `ACTOR_NOT_MEMBER`).
  Потребители: Task 7 (controller), Task 6/realtime (подписка hook), Task 8 (e2e).

- [ ] **Step 1: Падающие int-спеки**

Modify `packages/core/src/membership/membership.service.int-spec.ts`:

1. В импорты ошибок добавить `ActorNotMemberError, ActorNotOrganizerError, TargetNotExcludableError, TargetNotMemberError` (из `./membership.errors`); добавить импорт `TokenService` из `../auth/token.service`.
2. В `afterEach`-TRUNCATE добавить `membership."Exclusion"` и `identity."Session"`:

```ts
      'TRUNCATE TABLE membership."Exclusion", identity."Session", membership."Membership", room."Room" CASCADE',
```

3. Добавить новый describe в конец файла:

```ts
describe('MembershipService.exclude (REQ-ID-006, REQ-SEC-003)', () => {
  let db2: TestDb;
  let roomService2: RoomService;

  const makeMembership2 = () =>
    new MembershipService(
      db2.prisma,
      new IdentityService(db2.prisma),
      new JoinRateLimiter(1000),
      TEST_CONFIG,
    );

  beforeAll(async () => {
    db2 = await startTestDb();
    await seedIdentity(db2.prisma, { id: ORG, email: 'org2@example.test' });
    const outbox = new EventOutbox(db2.prisma, new RealtimeBus());
    roomService2 = new RoomService(
      db2.prisma,
      new EventLogService(new AppRegistryService([]), new EventEmitLimiter(1000), TEST_CONFIG, outbox),
      outbox,
      new AppRegistryService([]),
      new MembershipService(db2.prisma, new IdentityService(db2.prisma), new JoinRateLimiter(1000), TEST_CONFIG),
      TEST_CONFIG,
    );
  }, 120000);

  afterAll(async () => {
    await db2.stop();
  });

  afterEach(async () => {
    await db2.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE membership."Exclusion", identity."Session", membership."Membership", room."Room" CASCADE',
    );
  });

  // Активная комната ORG + вошедший гость; возвращает ids и ip гостя.
  async function roomWithGuest() {
    const room = await roomService2.create(ORG);
    const joined = await makeMembership2().join({ code: room.code, displayName: 'Гость', ip: IP });
    return { room, guest: joined };
  }

  it('happy path: soft-delete + Exclusion(ip, excludedBy, reason) + guest-сессии отозваны', async () => {
    const { room, guest } = await roomWithGuest();
    const tokens = new TokenService(db2.prisma, TEST_CONFIG);
    await tokens.issueGuestTokens(guest.identity.id, room.id);

    const result = await makeMembership2().exclude({
      roomId: room.id,
      targetIdentityId: guest.identity.id,
      actorId: ORG,
      reason: 'флуд',
    });

    expect(result).toEqual({ excluded: true });
    const membership = await db2.prisma.membership.findUnique({ where: { id: guest.membership.id } });
    expect(membership?.deletedAt).not.toBeNull();
    const exclusion = await db2.prisma.exclusion.findUnique({
      where: { roomId_identityId: { roomId: room.id, identityId: guest.identity.id } },
    });
    expect(exclusion).toMatchObject({ ip: IP, excludedBy: ORG, reason: 'флуд' });
    const sessions = await db2.prisma.session.findMany({ where: { identityId: guest.identity.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].revokedAt).not.toBeNull();
  });

  it('REGISTERED-цель сохраняет сессии (дизайн §0.2)', async () => {
    const room = await roomService2.create(ORG);
    const registered = await seedIdentity(db2.prisma, { kind: 'REGISTERED', email: 'reg@example.test' });
    await db2.prisma.membership.create({
      data: { roomId: room.id, identityId: registered.id, role: 'PARTICIPANT', joinIp: IP },
    });
    const tokens = new TokenService(db2.prisma, TEST_CONFIG);
    await tokens.issueGuestTokens(registered.id, room.id); // session row kind-агностичен

    await makeMembership2().exclude({ roomId: room.id, targetIdentityId: registered.id, actorId: ORG });

    const sessions = await db2.prisma.session.findMany({ where: { identityId: registered.id } });
    expect(sessions[0].revokedAt).toBeNull();
  });

  it('актор-не-член → ActorNotMemberError', async () => {
    const { room, guest } = await roomWithGuest();
    await expect(
      makeMembership2().exclude({ roomId: room.id, targetIdentityId: guest.identity.id, actorId: P1 }),
    ).rejects.toBeInstanceOf(ActorNotMemberError);
  });

  it('актор-участник (не ORGANIZER) → ActorNotOrganizerError (матрица REQ-ID-011)', async () => {
    const { room, guest } = await roomWithGuest();
    await expect(
      makeMembership2().exclude({ roomId: room.id, targetIdentityId: ORG, actorId: guest.identity.id }),
    ).rejects.toBeInstanceOf(ActorNotOrganizerError);
  });

  it('цель никогда не была членом → TargetNotMemberError', async () => {
    const { room } = await roomWithGuest();
    await expect(
      makeMembership2().exclude({ roomId: room.id, targetIdentityId: P1, actorId: ORG }),
    ).rejects.toBeInstanceOf(TargetNotMemberError);
  });

  it('цель — ORGANIZER → TargetNotExcludableError (защита от самоблокировки)', async () => {
    const { room } = await roomWithGuest();
    await expect(
      makeMembership2().exclude({ roomId: room.id, targetIdentityId: ORG, actorId: ORG }),
    ).rejects.toBeInstanceOf(TargetNotExcludableError);
  });

  it('повторное исключение — типизированный no-op без второго insert и без hook', async () => {
    const { room, guest } = await roomWithGuest();
    const service = makeMembership2();
    const handler = jest.fn();
    service.onAccessRevoked(handler);

    await service.exclude({ roomId: room.id, targetIdentityId: guest.identity.id, actorId: ORG });
    const second = await service.exclude({ roomId: room.id, targetIdentityId: guest.identity.id, actorId: ORG });

    expect(second).toEqual({ excluded: false });
    expect(await db2.prisma.exclusion.count()).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1); // только от первого, реального исключения
  });

  it('hook вызван пост-коммит с (identityId, roomId); бросок обработчика изолирован', async () => {
    const { room, guest } = await roomWithGuest();
    const service = makeMembership2();
    const calls: Array<[string, string]> = [];
    service.onAccessRevoked((identityId, roomId) => calls.push([identityId, roomId]));
    service.onAccessRevoked(() => { throw new Error('listener blew up'); });
    const afterThrow: Array<[string, string]> = [];
    service.onAccessRevoked((identityId, roomId) => afterThrow.push([identityId, roomId]));

    await expect(
      service.exclude({ roomId: room.id, targetIdentityId: guest.identity.id, actorId: ORG }),
    ).resolves.toEqual({ excluded: true });
    expect(calls).toEqual([[guest.identity.id, room.id]]);
    expect(afterThrow).toEqual([[guest.identity.id, room.id]]); // бросок соседа не помешал
  });
});
```

Замечание для исполнителя: существующий `describe('MembershipService.join ...')` держит свои `db`/`roomService`; новый describe заводит свои (`db2`/`roomService2`), потому что beforeAll старого не знает про truncate Exclusion/Session. Не объединять — не раздувать диф.

- [ ] **Step 2: Прогон — убедиться, что падают**

Run: `pnpm --filter @mymozhem/core test:int -t "exclude"`
Expected: FAIL компиляции (`exclude`/`onAccessRevoked`/ошибки не существуют) — это и есть красное состояние. Проверить >0 матчей фильтра.

- [ ] **Step 3: Ошибки**

Modify `packages/core/src/membership/membership.errors.ts` — добавить в `MEMBERSHIP_ERROR_CODES`:

```ts
  ACTOR_NOT_MEMBER: 'ACTOR_NOT_MEMBER',
  ACTOR_NOT_ORGANIZER: 'ACTOR_NOT_ORGANIZER',
  TARGET_NOT_MEMBER: 'TARGET_NOT_MEMBER',
  TARGET_NOT_EXCLUDABLE: 'TARGET_NOT_EXCLUDABLE',
```

и подклассы (после `RoomParticipantLimitReachedError`):

```ts
// Срез исключения (REQ-ID-006). Имена кодов совпадают с wire-кодами SDK —
// HttpExceptionFilter отдаёт MembershipError.code наружу как есть (REQ-SEC-006:
// message остаётся серверным).
export class ActorNotMemberError extends MembershipError {
  constructor(message: string) {
    super(MEMBERSHIP_ERROR_CODES.ACTOR_NOT_MEMBER, message);
  }
}

export class ActorNotOrganizerError extends MembershipError {
  constructor(message: string) {
    super(MEMBERSHIP_ERROR_CODES.ACTOR_NOT_ORGANIZER, message);
  }
}

export class TargetNotMemberError extends MembershipError {
  constructor(message: string) {
    super(MEMBERSHIP_ERROR_CODES.TARGET_NOT_MEMBER, message);
  }
}

export class TargetNotExcludableError extends MembershipError {
  constructor(message: string) {
    super(MEMBERSHIP_ERROR_CODES.TARGET_NOT_EXCLUDABLE, message);
  }
}
```

- [ ] **Step 4: exclude + hook-реестр**

Modify `packages/core/src/membership/membership.service.ts`:

1. Импорты: добавить `Logger` из `@nestjs/common`; новые ошибки из `./membership.errors`.
2. Поля и hook (после constructor):

```ts
export type AccessRevokedHandler = (identityId: string, roomId: string) => void;
```

и в классе:

```ts
  private readonly logger = new Logger(MembershipService.name);
  // Реестр обработчиков отзыва доступа (REQ-SEC-003): realtime-модуль подписывает
  // RealtimeGateway.revokeRoomAccess при инициализации (паттерн RealtimeBus.subscribe).
  // In-memory легален при одной реплике (REQ-OPS-005); состояние — поле экземпляра
  // (REQ-CORE-004). Любой вызывающий exclude получает разрыв подписок структурно.
  private readonly accessRevokedHandlers: AccessRevokedHandler[] = [];

  onAccessRevoked(handler: AccessRevokedHandler): void {
    this.accessRevokedHandlers.push(handler);
  }
```

3. Метод exclude (после `findActiveMembership`):

```ts
  // Исключение участника организатором (REQ-ID-006 ч.3): soft-delete membership,
  // запись Exclusion (rejoin-блок по IP), отзыв guest-сессий; пост-коммит —
  // немедленный разрыв подписок через hook (REQ-SEC-003). Порядок гейтов значим
  // (дизайн §3). Повтор — типизированный no-op (дизайн §0.4).
  async exclude(params: {
    roomId: string;
    targetIdentityId: string;
    actorId: string;
    reason?: string;
  }): Promise<{ excluded: boolean }> {
    const actor = await this.findActiveMembership(params.roomId, params.actorId);
    if (!actor) {
      throw new ActorNotMemberError(`actor ${params.actorId} is not a member of room ${params.roomId}`);
    }
    if (actor.role !== 'ORGANIZER') {
      throw new ActorNotOrganizerError(`actor ${params.actorId} is not ORGANIZER of room ${params.roomId}`);
    }
    const target = await this.prisma.membership.findUnique({
      where: { roomId_identityId: { roomId: params.roomId, identityId: params.targetIdentityId } },
      include: { identity: true },
    });
    if (!target) {
      throw new TargetNotMemberError(`target ${params.targetIdentityId} is not a member of room ${params.roomId}`);
    }
    if (target.deletedAt !== null) return { excluded: false };
    if (target.role === 'ORGANIZER') {
      throw new TargetNotExcludableError(`ORGANIZER of room ${params.roomId} cannot be excluded`);
    }
    // Инвариант: не-ORGANIZER membership всегда имеет joinIp (пишется в join).
    if (target.joinIp === null) {
      throw new Error(`invariant violated: non-organizer membership ${target.id} without joinIp`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: target.id }, data: { deletedAt: new Date() } });
      await tx.exclusion.create({
        data: {
          roomId: params.roomId,
          identityId: params.targetIdentityId,
          ip: target.joinIp!,
          excludedBy: params.actorId,
          reason: params.reason ?? null,
        },
      });
      // Отзыв сессий — только гостю (дизайн §0.2): гостевая identity однокомнатная.
      if (target.identity.kind === 'GUEST') {
        await tx.session.updateMany({
          where: { identityId: params.targetIdentityId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });
    // Пост-коммит: изоляция per-handler (прецедент fanOut) — бросок слушателя
    // не валит запрос после коммита; сигнал — в серверном логе.
    for (const handler of this.accessRevokedHandlers) {
      try {
        handler(params.targetIdentityId, params.roomId);
      } catch (err) {
        this.logger.error(
          `access-revoked handler failed for ${params.targetIdentityId} in ${params.roomId}: ${(err as Error).message}`,
        );
      }
    }
    return { excluded: true };
  }
```

Замечание для исполнителя: `target.joinIp!` — после guard'а выше non-null; если lint ругается на non-null assertion, вынести `const joinIp = target.joinIp;` после guard с сужением типа (`if (joinIp === null) throw …`).

- [ ] **Step 5: Прогон — зелёные**

Run: `pnpm --filter @mymozhem/core test:int -t "exclude"`
Expected: PASS (8 новых спеков).

- [ ] **Step 6: Прогон остальных core-гейтов, затронутых файлом**

Run: `pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/membership
git commit -m "feat(core): MembershipService.exclude — soft-delete, Exclusion, отзыв guest-сессий, hook отзыва доступа (REQ-ID-006, REQ-SEC-003, REQ-ID-011)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Rejoin-блок в join

**Files:**
- Modify: `packages/core/src/membership/membership.service.ts` (метод `join`)
- Modify: `packages/core/src/membership/membership.service.int-spec.ts`

**Interfaces:**
- Consumes: `prisma.exclusion` (Task 2), `exclude` (Task 4 — спеки строят блок через него).
- Produces: `join` бросает `RoomJoinDeniedError` при записи `Exclusion(roomId, ip)`. Потребитель: e2e (Task 8).

- [ ] **Step 1: Падающие int-спеки**

Modify `packages/core/src/membership/membership.service.int-spec.ts` — добавить в `describe('MembershipService.exclude ...')`:

```ts
  it('rejoin с IP исключённого → RoomJoinDeniedError, неотличим от «неверного кода» (REQ-ID-013)', async () => {
    const { room, guest } = await roomWithGuest();
    await makeMembership2().exclude({ roomId: room.id, targetIdentityId: guest.identity.id, actorId: ORG });
    await expect(
      makeMembership2().join({ code: room.code, displayName: 'Снова', ip: IP }),
    ).rejects.toBeInstanceOf(RoomJoinDeniedError);
  });

  it('rejoin с ДРУГОГО IP проходит — задокументированный обход REQ-ID-006', async () => {
    const { room, guest } = await roomWithGuest();
    await makeMembership2().exclude({ roomId: room.id, targetIdentityId: guest.identity.id, actorId: ORG });
    const rejoined = await makeMembership2().join({ code: room.code, displayName: 'Снова', ip: IP2 });
    expect(rejoined.membership.role).toBe('PARTICIPANT');
  });

  it('исключение в одной комнате не блокирует вход в другую', async () => {
    const { room, guest } = await roomWithGuest();
    const other = await roomService2.create(ORG);
    await makeMembership2().exclude({ roomId: room.id, targetIdentityId: guest.identity.id, actorId: ORG });
    const joined = await makeMembership2().join({ code: other.code, displayName: 'Снова', ip: IP });
    expect(joined.membership.roomId).toBe(other.id);
  });
```

- [ ] **Step 2: Прогон — убедиться, что падает (первый спек)**

Run: `pnpm --filter @mymozhem/core test:int -t "rejoin"`
Expected: первый FAIL (join проходит), остальные PASS. Проверить 3 матча.

- [ ] **Step 3: Реализация**

Modify `packages/core/src/membership/membership.service.ts` — в `join` после ветки `joinPolicy !== 'GUESTS'`, до подсчёта участников:

```ts
    // Rejoin-блок исключённых (REQ-ID-006 ч.3): свёрнут в тот же ROOM_JOIN_DENIED —
    // факт исключения не раскрывается (REQ-ID-013). Обход сменой сети —
    // задокументированный лимит нормы; device-cookie-признак — шов (дизайн §9).
    const excluded = await this.prisma.exclusion.findFirst({
      where: { roomId: room.id, ip: params.ip },
    });
    if (excluded) {
      throw new RoomJoinDeniedError(`ip excluded from room ${room.id}`);
    }
```

- [ ] **Step 4: Прогон — зелёные**

Run: `pnpm --filter @mymozhem/core test:int -t "MembershipService"`
Expected: PASS (весь файл).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/membership
git commit -m "feat(core): rejoin-блок исключённых по IP в join (REQ-ID-006 ч.3, единообразие REQ-ID-013)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: M-3 — stale registry entry при disconnect внутри subscribe + подписка hook в gateway

**Files:**
- Modify: `packages/core/src/realtime/realtime.gateway.ts`
- Modify: `packages/core/src/realtime/realtime.gateway.spec.ts`

**Interfaces:**
- Consumes: `MembershipService.onAccessRevoked` (Task 4).
- Produces: `handleSubscribe` не оставляет записи реестра для разорванного сокета; `afterInit` подписывает `revokeRoomAccess` на hook membership. Потребитель: Task 8 (e2e полного пути).

- [ ] **Step 1: Падающие unit-спеки**

Modify `packages/core/src/realtime/realtime.gateway.spec.ts`:

1. В `fakeSocket` добавить поле `connected: true` (иначе новая проверка сломает все subscribe-спеки: `undefined` фолси).
2. В `makeGateway` — membership-фейк по умолчанию получает `onAccessRevoked: jest.fn()` (и в тип overrides): заменить строку дефолта membership на

```ts
  const membership = overrides.membership ?? {
    findActiveMembership: jest.fn().mockResolvedValue({ role: 'PARTICIPANT' }),
    onAccessRevoked: jest.fn(),
  };
```

и тип `overrides.membership` — `{ findActiveMembership: jest.Mock; onAccessRevoked?: jest.Mock }`.
3. Добавить спеки:

```ts
  // M-3: disconnect внутри subscribe (между registry.add и ack) — слушатель disconnect
  // уже сделал remove no-op'ом; без проверки connected запись мёртвого сокета протухала
  // бы в реестре. Фикс: финальная проверка socket.connected до ack.
  it('disconnect mid-subscribe leaves no registry entry and sends no ack (M-3)', async () => {
    const registry = new SubscriptionRegistry();
    const { gateway } = makeGateway({ registry });
    const socket = fakeSocket();
    socket.connected = false; // disconnect прилетел, пока subscribe читал лог
    const { ack, calls } = ackOf();
    await gateway.handleSubscribe(socket as never, { roomId: ROOM }, ack);
    expect(registry.get(socket.id)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('afterInit подписывает revokeRoomAccess на hook membership (REQ-SEC-003)', () => {
    const onAccessRevoked = jest.fn();
    const { gateway } = makeGateway({ membership: { findActiveMembership: jest.fn(), onAccessRevoked } });
    const use = jest.fn();
    const on = jest.fn();
    const server = { use, on, sockets: { sockets: new Map() } };
    // bus.subscribe — фейк в makeGateway: { subscribe: jest.fn(), publish: jest.fn() }
    gateway.afterInit(server as never);
    expect(onAccessRevoked).toHaveBeenCalledTimes(1);
    expect(onAccessRevoked.mock.calls[0][0]).toBeInstanceOf(Function);
  });
```

- [ ] **Step 2: Прогон — убедиться, что падают**

Run: `pnpm --filter @mymozhem/core test -t "M-3|hook membership"`
Expected: FAIL (запись остаётся / ack ушёл; onAccessRevoked не вызван). Проверить 2 матча.

- [ ] **Step 3: Реализация**

Modify `packages/core/src/realtime/realtime.gateway.ts`:

1. В `afterInit`, после `this.bus.subscribe(...)`:

```ts
    // REQ-SEC-003: срез исключения вызывает MembershipService.exclude → пост-коммит
    // hook → немедленный разрыв подписок (шов дизайна realtime §9 исполнен).
    this.membership.onAccessRevoked((identityId, roomId) => this.revokeRoomAccess(identityId, roomId));
```

2. В `handleSubscribe`, непосредственно перед `ack({ ok: true, snapshot });` (внутри try):

```ts
      // M-3: disconnect, прилетевший внутри subscribe (пока читался лог), уже прошёл
      // слушателем как no-op (записи не было). Без этой проверки запись мёртвого
      // сокета протухла бы в реестре. Disconnect ПОСЛЕ проверки обслужит штатный
      // слушатель — запись уже существует.
      if (!socket.connected) {
        this.registry.remove(socket.id);
        socket.leave(roomChannel(roomId));
        socket.leave(organizerChannel(roomId));
        return;
      }
```

- [ ] **Step 4: Прогон — зелёные, весь unit-файл не сломан**

Run: `pnpm --filter @mymozhem/core test -t "RealtimeGateway"`
Expected: PASS (старые спеки включительно — fakeSocket.connected = true их сохраняет).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/realtime
git commit -m "fix(core): M-3 — stale registry entry при disconnect внутри subscribe + gateway подписан на hook exclude (REQ-SEC-003)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Endpoint exclude (transport)

**Files:**
- Modify: `packages/core/src/transport/http.types.ts` (+ `headers`)
- Create: `packages/core/src/transport/exclude.controller.ts`
- Modify: `packages/core/src/transport/http-exception.filter.ts` (+3 статуса)
- Modify: `packages/core/src/transport/http-exception.filter.spec.ts`
- Modify: `packages/core/src/transport/transport.module.ts`
- Modify: `apps/server/test/transport.e2e-spec.ts`

**Interfaces:**
- Consumes: `excludeRequestSchema`/`ExcludeResponse`/новые коды (Task 1), `MembershipService.exclude` (Task 4), `TokenService.verifyAccessToken` (существует).
- Produces: `POST /rooms/:roomId/members/:identityId/exclude`, Bearer access JWT. Потребитель: Task 8.

- [ ] **Step 1: Падающий unit-спек фильтра**

Modify `packages/core/src/transport/http-exception.filter.spec.ts` — добавить кейсы маппинга (стиль существующих кейсов файла: скормить фильтру экземпляр ошибки, проверить status+body):

```ts
  it.each([
    [new ActorNotMemberError('x'), 403, 'ACTOR_NOT_MEMBER'],
    [new ActorNotOrganizerError('x'), 403, 'ACTOR_NOT_ORGANIZER'],
    [new TargetNotMemberError('x'), 404, 'TARGET_NOT_MEMBER'],
    [new TargetNotExcludableError('x'), 409, 'TARGET_NOT_EXCLUDABLE'],
  ] as const)('maps %s → %i %s', (err, status, code) => {
    // тот же хелпер прогона фильтра, что в существующих кейсах файла
  });
```

(Исполнитель: переиспользовать существующий хелпер/паттерн этого spec-файла; импортировать новые ошибки из `../membership/membership.errors`.)

- [ ] **Step 2: Падающие e2e HTTP-уровня**

Modify `apps/server/test/transport.e2e-spec.ts` — новый `describe('exclude endpoint (REQ-ID-006)')`. Хелперы файла (`createApp`, `app.inject`, `seedIdentity`, `roomService`… по прецеденту существующих describe): фабрикация — комната через `RoomService.create(ORG)` (ORG seeded), участник через `POST /rooms/join`, токены через `new TokenService(db.prisma, TEST_CONFIG).issueGuestTokens(...)`. Кейсы:

```ts
  it('без Bearer → 401 SESSION_INVALID', ...)
  it('гостевой токен чужой комнаты → 403 ACTOR_NOT_MEMBER (scope REQ-ID-016)', ...)
  it('актор-участник (не ORGANIZER) → 403 ACTOR_NOT_ORGANIZER', ...)
  it('цель никогда не была членом → 404 TARGET_NOT_MEMBER', ...)
  it('цель — ORGANIZER → 409 TARGET_NOT_EXCLUDABLE', ...)
  it('happy path → 200 { excluded: true }; повтор → 200 { excluded: false }', ...)
  it('невалидный uuid в path → 400 REQUEST_INVALID', ...)
  it('лишний ключ в body → 400 REQUEST_INVALID (strictObject)', ...)
```

(Каждый кейс — полноценный `it` с `app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload })` и ассертами `statusCode` + `res.json()`; развернуть по образцу существующих e2e-спеков файла. Замечание: `organizerToken` здесь — `issueGuestTokens(ORG, room.id)`: claims GUEST+roomId, scope-проверка контроллера его пропускает, роль ORGANIZER берётся из membership.)

Run: сначала `pnpm build` в корне (server e2e резолвит core из dist), затем `pnpm --filter @mymozhem/server test -t "exclude endpoint"`.
Expected: FAIL (404 неизвестного роута → Nest HttpException 404, не наши коды). Проверить >0 матчей.

- [ ] **Step 3: RequestLike + headers**

Modify `packages/core/src/transport/http.types.ts`:

```ts
export interface RequestLike {
  readonly ip: string;
  readonly cookies: Record<string, string | undefined>;
  // Bearer-аутентификация REST (срез исключения): первый REST-потребитель Authorization.
  readonly headers: Record<string, string | string[] | undefined>;
}
```

- [ ] **Step 4: ExcludeController**

Create `packages/core/src/transport/exclude.controller.ts`:

```ts
import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { excludeRequestSchema, type ExcludeResponse } from '@mymozhem/sdk';
import { z } from 'zod';
import { MembershipService } from '../membership/membership.service';
import { ActorNotMemberError } from '../membership/membership.errors';
import { TokenService, type AccessClaims } from '../auth/token.service';
import type { RequestLike } from './http.types';

// actorId НЕ принимается из payload/path — актор определяется только access JWT
// (REQ-RT-009 по духу HTTP, прецедент JoinController). ZodError/доменные ошибки
// уходят в фильтр — контроллер статусов не знает (design §5).
@Controller()
export class ExcludeController {
  constructor(
    private readonly membership: MembershipService,
    private readonly tokens: TokenService,
  ) {}

  @Post('rooms/:roomId/members/:identityId/exclude')
  @HttpCode(200)
  async exclude(
    @Param('roomId') roomId: string,
    @Param('identityId') identityId: string,
    @Body() body: unknown,
    @Req() req: RequestLike,
  ): Promise<ExcludeResponse> {
    const claims = this.authenticate(req);
    const parsedRoomId = z.uuid().parse(roomId);
    const { reason } = excludeRequestSchema.parse(body ?? {});
    // REQ-ID-016: гостевой scope зашит в токен — GUEST действует только в своей
    // комнате (та же норма, что guest-scope в subscribe).
    if (claims.kind === 'GUEST' && claims.roomId !== parsedRoomId) {
      throw new ActorNotMemberError(`guest token scoped to ${claims.roomId}, not ${parsedRoomId}`);
    }
    return this.membership.exclude({
      roomId: parsedRoomId,
      targetIdentityId: z.uuid().parse(identityId),
      actorId: claims.sub,
      reason,
    });
  }

  // Первый Bearer-аутентифицированный REST-путь: паттерн «извлечь → verifyAccessToken».
  // Невалидный/отсутствующий токен — AuthError SESSION_INVALID (фильтр → 401).
  private authenticate(req: RequestLike): AccessClaims {
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    return this.tokens.verifyAccessToken(token);
  }
}
```

- [ ] **Step 5: Фильтр + wiring**

Modify `packages/core/src/transport/http-exception.filter.ts` — в `STATUS_BY_WIRE_CODE` добавить:

```ts
  ACTOR_NOT_MEMBER: 403,
  ACTOR_NOT_ORGANIZER: 403,
  TARGET_NOT_MEMBER: 404,
  TARGET_NOT_EXCLUDABLE: 409,
```

Modify `packages/core/src/transport/transport.module.ts` — импорт `ExcludeController` и добавить в `controllers: [JoinController, AuthController, ExcludeController]`.

- [ ] **Step 6: Прогон — зелёные**

Run: `pnpm --filter @mymozhem/core test -t "HttpExceptionFilter"` → PASS; затем `pnpm build` в корне и `pnpm --filter @mymozhem/server test -t "exclude endpoint"` → PASS (8 кейсов).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/transport apps/server/test/transport.e2e-spec.ts
git commit -m "feat(core): endpoint POST /rooms/:id/members/:id/exclude — Bearer auth, гейт ORGANIZER (REQ-ID-006/011, REQ-SEC-006)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: e2e полного пути — критерий ф.1 «немедленный отзыв подписки при исключении»

**Files:**
- Modify: `apps/server/test/realtime.e2e-spec.ts`

**Interfaces:**
- Consumes: всё предыдущее. Хелперы файла: `activeRoomWithGuest()`, `organizerToken(roomId)`, `connect`, `emitAck`, `tokens`.

- [ ] **Step 1: e2e-спек**

Modify `apps/server/test/realtime.e2e-spec.ts` — добавить в основной describe (после спека `revokeRoomAccess разрывает подписки…`):

```ts
  it('исключение организатором: разрыв подписки, ACTOR_NOT_MEMBER на ресubscribe, refresh 401, rejoin 403 (критерий ф.1, REQ-SEC-003)', async () => {
    // join по HTTP с сохранением refresh-куки (activeRoomWithGuest её отбрасывает —
    // здесь путь развёрнут вручную ради куки).
    const room = await roomService.create(ORG);
    await roomService.activate(room.id, ORG);
    const joinRes = await app.inject({
      method: 'POST',
      url: '/rooms/join',
      payload: { code: room.code, displayName: 'Гостя' },
    });
    expect(joinRes.statusCode).toBe(201);
    const { accessToken } = tokenResponseSchema.parse(joinRes.json());
    const refreshCookie = joinRes.cookies.find((c) => c.name === 'mm_refresh');
    expect(refreshCookie).toBeDefined();
    const participantId = tokens.verifyAccessToken(accessToken).sub;

    const socket = await connect(port, accessToken);
    await emitAck(socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    const disconnected = new Promise<void>((resolve) => socket.on('disconnect', () => resolve()));

    const orgToken = await organizerToken(room.id);
    const res = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/members/${participantId}/exclude`,
      headers: { authorization: `Bearer ${orgToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ excluded: true });
    await disconnected; // немедленный разрыв подписки (REQ-SEC-003)
    expect(socket.connected).toBe(false);

    // Старый access ещё валиден (≤15 мин), но членство мертво: subscribe → ACTOR_NOT_MEMBER.
    const socket2 = await connect(port, accessToken);
    const ack = await emitAck(socket2, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    expect(ack).toEqual({ code: 'ACTOR_NOT_MEMBER' });
    socket2.close();

    // Refresh-сессия отозвана: перевыпуск access невозможен.
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { mm_refresh: refreshCookie!.value },
    });
    expect(refreshRes.statusCode).toBe(401);
    expect(refreshRes.json()).toEqual({ code: 'SESSION_INVALID' });

    // Rejoin с того же IP (app.inject → 127.0.0.1, как и первый join) → единообразный отказ.
    const rejoin = await app.inject({
      method: 'POST',
      url: '/rooms/join',
      payload: { code: room.code, displayName: 'Снова' },
    });
    expect(rejoin.statusCode).toBe(403);
    expect(rejoin.json()).toEqual({ code: 'ROOM_JOIN_DENIED' });
  });
```

Замечания для исполнителя:
- Импортов новых не нужно: `tokenResponseSchema`, `REALTIME_MESSAGES` уже импортированы в файле.
- Активация без `configure` допустима? Проверить по `RoomService.activate`: если требует пин (appId), скопировать тройку вызовов `configure` из `activeRoomWithGuest` перед `activate`.
- Имя refresh-куки — `mm_refresh` (константа `REFRESH_COOKIE` в core; в e2e литерал допустим, как и прочие wire-литералы файла).

- [ ] **Step 2: Прогон**

Run: `pnpm build` в корне, затем `pnpm --filter @mymozhem/server test -t "исключение организатором"`
Expected: PASS. Проверить 1 матч.

- [ ] **Step 3: Commit**

```bash
git add apps/server/test/realtime.e2e-spec.ts
git commit -m "test(server): e2e исключения полным путём — разрыв подписки, отзыв сессии, rejoin-блок (критерий ф.1, REQ-SEC-003)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Гейты зелёные

**Files:** нет (только прогоны; фиксы — при необходимости виновному таску).

- [ ] **Step 1: Полный прогон всех гейтов на слитом результате**

```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm --filter @mymozhem/server test && pnpm boundary-check && pnpm guardrails
```

Expected: всё зелёное. Docker Desktop запущен (int/e2e).

- [ ] **Step 2: Финализация**

Если всё зелёное — сообщить владельцу: срез готов к мерджу (мердж --no-ff, затем LOC-снапшот по `docs/stats/loc-snapshots.md` и обновление HANDOFF — по заведённому ритуалу, решение владельца).

---

## Self-review (пройдено автором плана)

- **Покрытие дизайна:** §2 миграция → Task 2; §3 exclude + §4 hook → Task 4; §5 rejoin → Task 5; §6 контракт/endpoint → Tasks 1, 7; §7 M-3 → Task 6; §8 тесты → Tasks 1–8 (контрактные → 1, int → 2–5, unit hook → 4, M-3 → 6, e2e → 7–8); гейты → Task 9. Отклонение от дизайна §2 (joinIp nullable) объявлено в шапке плана и требует санкции.
- **Placeholder-скан:** код всех шагов приведён; два места сознательно делегированы исполнителю с указанием паттерна (кейсы фильтра в Task 7 Step 1 — «тот же хелпер, что в файле»; развёртывание 8 e2e-кейсов в Task 7 Step 2 — по образцу существующих спеков того же файла) — это расширение по живому образцу, не отсутствие содержимого.
- **Типовая согласованность:** `exclude`/`onAccessRevoked`/`AccessRevokedHandler`/имена ошибок/имена схем одинаковы во всех тасках; wire-коды Task 1 = статусы Task 7 = ассерты Task 8.
