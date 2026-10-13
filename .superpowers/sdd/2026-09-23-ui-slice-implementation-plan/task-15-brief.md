### Task 15: Консоль — участники (exclude), призы, розыгрыш, вручение, завершение

**Files:**
- Create: `apps/web/src/pages/host/members-panel.tsx`, `apps/web/src/pages/host/prizes-panel.tsx`, `apps/web/src/pages/host/awards-panel.tsx`
- Modify: `apps/web/src/pages/host/console-page.tsx`
- Test: `apps/web/src/pages/host/prizes-panel.spec.ts` (селектор «приз доступен для розыгрыша»: quantity > 0)

**Interfaces:**
- Consumes: `listMembers/excludeMember/listPrizes/createPrize/listRewards/fulfillAward/revokeAward/completeRoom` (Task 7); publish `lottery.draw.run` `{ drawId: crypto.randomUUID(), prizeId }` (только в lottery-комнате — панель рисуется по пину из `core.room.activated` payload `appId`).

- [ ] **Step 1: Failing test** — селектор доступных для розыгрыша призов (`quantity > 0`); повторный клик draw до ack — disabled (drawId один на попытку — идемпотентность, дизайн ф.3 §4)

- [ ] **Step 2: Implement** — members-panel: ростер (role participant/spectator) + «Исключить» → `excludeMember` → рефетч; prizes-panel: форма name+quantity → `createPrize` → рефетч `listPrizes`; в lottery-комнате — кнопка «Разыграть» у приза с quantity>0 → publish draw.run → результат виден в `<Winners>` (draw.completed из live); awards-panel: `listRewards` + roster-имена + кнопки fulfill/revoke (disabled не в AWARDED) → рефетч; «Завершить событие» → `completeRoom` (confirm()) → статус COMPLETED.

- [ ] **Step 3: Run green**, typecheck/build

- [ ] **Step 4: Commit** — `feat(web): консоль — участники/призы/розыгрыш/вручение/завершение`

---

## Батч E — e2e и приёмка

