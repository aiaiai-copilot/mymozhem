### Task 8: core — membership: join с ролью spectator

**Files:**
- Modify: `packages/core/src/membership/membership.service.ts:145-194` (`join`)
- Modify: `packages/core/src/transport/join.controller.ts:27-28`
- Test: `packages/core/src/membership/membership.service.int-spec.ts`

**Interfaces:**
- Consumes: `JoinRequest.role` (Task 2).
- Produces: `MembershipService.join(params: { code; displayName; ip; role?: 'participant' | 'spectator' })`.

**REQ:** REQ-ID-011 (назначение SPECTATOR), REQ-ID-013 (единообразие отказов не трогается).

- [ ] **Step 1: Failing int tests**

В `membership.service.int-spec.ts`:

```typescript
it('join with role spectator creates SPECTATOR membership', async () => {
  const { membership } = await membership.join({ code, displayName: 'Зритель', ip: '10.0.0.9', role: 'spectator' });
  expect(membership.role).toBe('SPECTATOR');
});

it('spectator does not consume the participant limit', async () => {
  // комната заполнена до ROOM_PARTICIPANT_LIMIT участниками (существующий харнесс лимита);
  // join spectator → успех; join participant → ROOM_PARTICIPANT_LIMIT_REACHED (как раньше).
});

it('default join (no role) stays PARTICIPANT', async () => { /* регрессия */ });
```

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test:int -- membership`
Expected: FAIL (join не принимает role).

- [ ] **Step 3: Implement**

`membership.service.ts` — сигнатура и создание:

```typescript
  async join(params: { code: string; displayName: string; ip: string; role?: 'participant' | 'spectator' }): Promise<JoinResult> {
```

```typescript
      const membership = await tx.membership.create({
        data: {
          roomId: room.id,
          identityId: identity.id,
          joinIp: params.ip,
          // REQ-ID-011: самоназначение зрителем (фаза 2). Только два wire-значения
          // (SDK-схема), маппинг здесь — единственная точка.
          role: params.role === 'spectator' ? 'SPECTATOR' : 'PARTICIPANT',
        },
      });
```

Лимит участников не меняется: count уже фильтрует `role: 'PARTICIPANT'` — зритель слота не занимает (осознанно: зритель не нагружает арбитраж). `join.controller.ts`: `const { code, displayName, role } = joinRequestSchema.parse(body);` → `this.membership.join({ code, displayName, role, ip: req.ip })`.

- [ ] **Step 4: Run — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- membership && pnpm --filter @mymozhem/server test -- transport`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): join с самоназначением SPECTATOR (REQ-ID-011); зритель не занимает лимит участников

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

