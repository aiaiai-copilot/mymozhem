### Task 1: SDK — событие `member.joined`, контракт 2.1.0

**Files:**
- Modify: `packages/sdk/src/events/core-events.ts` (CORE_EVENTS :21-42)
- Modify: `packages/sdk/src/contract-version.ts:8`, `packages/sdk/package.json:3`
- Test: `packages/sdk/src/events/core-events.contract.spec.ts`

**Interfaces:**
- Produces: `CORE_EVENTS['member.joined'] = { schema: z.strictObject({ identityId: z.uuid() }), visibility: 'public', version: 1 }`; `coreEventType('member.joined')` → `'core.member.joined'`; `CONTRACT_VERSION = '2.1.0'`. Потребители: T2 (ядро), T12 (web-триггер по строке типа).

- [ ] **Step 1: Failing test** — в `core-events.contract.spec.ts`: точный список ключей (:5-11) += `'member.joined'`; кейсы payload: `{identityId: uuid}` валиден, `{}` отклонён, лишний ключ отклонён (strict), не-uuid отклонён; visibility public; version 1.
- [ ] **Step 2:** `pnpm --filter @mymozhem/sdk test` — RED (ключа нет).
- [ ] **Step 3:** Добавить запись в `CORE_EVENTS` (по прецеденту `room.activated`); `CONTRACT_VERSION = '2.1.0'`; `package.json` version `2.1.0`.
- [ ] **Step 4:** `pnpm --filter @mymozhem/sdk test` — GREEN (включая `contract-version.contract.spec.ts` — парность версий).
- [ ] **Step 5:** `pnpm --filter @mymozhem/sdk build && pnpm build` — сборка всего дерева (core/web резолвят dist).
- [ ] **Step 6: Commit** `feat(sdk): core-событие member.joined (payload identityId, public) — CONTRACT_VERSION 2.1.0`.

