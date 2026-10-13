### Task 2: drawPool — фильтр swept-гостей (P2)

**Files:**
- Modify: `packages/core/src/membership/membership.service.ts:144-155` (`listActiveParticipantPool`)
- Test: int-спека, покрывающая `listActiveParticipantPool` (найти: `grep -rn "listActiveParticipantPool" packages/core/src --include="*.int-spec.ts"`)

**Interfaces:**
- Produces: пул розыгрыша исключает identity с `deletedAt != null` (TTL-истёкшие гости).

- [ ] **Step 1: Failing test**

```ts
it('excludes swept (anonymized) guests from the draw pool (P2)', async () => {
  // arrange: комната + два PARTICIPANT-гостя (паттерн существующих кейсов пула)
  await prisma.identity.update({
    where: { id: sweptGuestId },
    data: { deletedAt: new Date(), displayName: null },
  });
  const pool = await membership.listActiveParticipantPool(roomId);
  expect(pool.map((p) => p.identityId)).toEqual([aliveGuestId]);
});
```

- [ ] **Step 2: Run** — `pnpm --filter @mymozhem/core test:int -- membership` → FAIL (swept-гость в пуле)

- [ ] **Step 3: Implement** — в `where` добавить `identity: { deletedAt: null }`:

```ts
      where: {
        roomId,
        role: 'PARTICIPANT',
        deletedAt: null,
        room: { deletedAt: null },
        identity: { deletedAt: null }, // P2: swept-гость (TTL-анонимизация) вне пула розыгрыша
      },
```

- [ ] **Step 4: Run** — тот же прогон зелёный + полный `pnpm --filter @mymozhem/core test:int`

- [ ] **Step 5: Commit** — `fix(core): drawPool исключает swept-гостей (identity.deletedAt) — решение владельца P2`

