### Task 8: Свип += joinIp/Exclusion

**REQ:** REQ-ID-014 (расширение реализации, текст нормы не меняется), REQ-SEC-004 (IP живёт не дольше события + guest_ttl), REQ-ID-006 (живой контур не ослабляется).

**Files:**
- Modify: `packages/core/src/identity/guest-sweep.service.ts` (tx += 2 оператора)
- Modify: `packages/core/src/identity/guest-sweep.int-spec.ts` (+= describe инварианта)
- Modify: `packages/core/src/membership/membership.service.int-spec.ts:296-302` (симуляция свипа синхронизирована с реальным)

**Interfaces:**
- Consumes: ничего из задач среза (самостоятельна в батче C).
- Produces: инвариант «после свипа joinIp=null и Exclusion удалены» (критерий выхода 5).

- [ ] **Step 1: Падающий инвариант-тест** — новый describe в `guest-sweep.int-spec.ts` (по образцу существующих: testcontainer, identity/membership/exclusion сидятся напрямую, `sweepExpiredGuests(now)` вызывается с контролируемым now):

```ts
describe('ADR-012 §3: IP не живёт дольше события + guest_ttl', () => {
  it('свип обнуляет joinIp членств и удаляет Exclusion свипнутой identity', async () => {
    // arrange: комната; гость с createdAt < cutoff, membership.joinIp='10.1.2.3',
    // Exclusion(roomId, identityId гостя, ip='10.1.2.3'); ВТОРОЙ гость свежий
    // (createdAt > cutoff) с membership.joinIp='10.9.9.9' — контрольная группа.
    const swept = await service.sweepExpiredGuests(now);
    expect(swept).toBe(1);
    const membership = await prisma.membership.findUniqueOrThrow({ where: { roomId_identityId: { roomId, identityId: guestId } } });
    expect(membership.joinIp).toBeNull();
    expect(await prisma.exclusion.count({ where: { identityId: guestId } })).toBe(0);
    // живой контур не тронут (REQ-ID-006): IP свежего гостя на месте
    const fresh = await prisma.membership.findUniqueOrThrow({ where: { roomId_identityId: { roomId, identityId: freshId } } });
    expect(fresh.joinIp).toBe('10.9.9.9');
  });
  it('приостановленная гардой identity (открытый award) сохраняет joinIp и Exclusion до следующего свипа', async () => {
    // guard-фейк возвращает [guestId] из hasOpenAwards → swept=0, joinIp на месте, Exclusion на месте
  });
});
```

- [ ] **Step 2: Прогон — красный** (`pnpm --filter @mymozhem/core test:int -- guest-sweep` → joinIp не null).

- [ ] **Step 3: Реализация** — в `guest-sweep.service.ts` внутри tx, после отзыва сессий (строка ~73), ДО re-check C-8.1:

```ts
        // ADR-012 §3: IP живёт не дольше события + guest_ttl — обнуление joinIp
        // членств и удаление Exclusion свипнутых identity в той же tx. Rejoin-блок
        // снимается вместе с записью — осознанно (ADR); живой контур (REQ-ID-006)
        // не тронут: до свипа joinIp/Exclusion работают как прежде.
        await tx.membership.updateMany({
          where: { identityId: { in: sweepIds } },
          data: { joinIp: null },
        });
        await tx.exclusion.deleteMany({
          where: { identityId: { in: sweepIds } },
        });
```

- [ ] **Step 4: Прогон — зелёный + синхронизация симуляции.** `membership.service.int-spec.ts:296-302` симулирует свип вручную (updateMany identity) — дополнить симуляцию обнулением joinIp/удалением Exclusion ИЛИ (лучше) заменить ручную симуляцию вызовом реального `GuestSweepService.sweepExpiredGuests` — выбрать по локальному контексту спеки, зафиксировать выбор в коммите.

```bash
pnpm --filter @mymozhem/core test:int -- guest-sweep && pnpm --filter @mymozhem/core test:int -- membership.service
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/identity packages/core/src/membership
git commit -m "feat(core): свип += joinIp/Exclusion (ADR-012 §3) — IP не живёт дольше события + guest_ttl; приостановка гардой сохраняет IP до разрешения award"
```

---

