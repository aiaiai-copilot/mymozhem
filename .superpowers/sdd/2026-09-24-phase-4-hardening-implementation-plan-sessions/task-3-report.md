# Task 3 Report — Award-гарда identity.deletedAt (C-8.1, сторона award)

**Status:** DONE
**Commit:** `3b6e19069e4cb7e56487bc235c42af30031309ab` (branch `phase-4-hardening`)
**Message:** `fix(rewards): refuse prize award to anonymized identity (C-8.1) — IDENTITY_ANONYMIZED` (+ Co-Authored-By trailer)

## Files changed (ровно 5 из брифа)

- `packages/core/src/rewards/rewards.errors.ts` — добавлен `IdentityAnonymizedError extends ContractError` (код `IDENTITY_ANONYMIZED`) дословно по брифу.
- `packages/core/src/rewards/rewards.service.ts` — импорт ошибки; winner-гарда в `awardPrize` между проверкой `prize` (:71-72) и raw INSERT (:78→:86), дословно по брифу (чтение `identity` в той же tx, `deletedAt !== null || winner === null` → throw до insert/декремента).
- `packages/core/src/transport/http-exception.filter.ts` — `IDENTITY_ANONYMIZED: 409,` сразу после `REWARD_ALREADY_RESOLVED: 409,` с комментарием брифа.
- `packages/core/src/transport/http-exception.filter.spec.ts` — кейс `['identity anonymized', new ContractError('IDENTITY_ANONYMIZED', 'x'), 409, 'IDENTITY_ANONYMIZED']` рядом с rewards-кодами (после `reward already resolved`).
- `packages/core/src/rewards/rewards.int-spec.ts` — новый it-кейс C-8.1 в основном describe, после первого award.prize-кейса.

## Pre-work

`pnpm --filter @mymozhem/sdk build` выполнен до всего; dist 1.8.0 содержит `IDENTITY_ANONYMIZED` (проверено grep по `dist/errors/error-codes.d.ts|.js`).

## RED (Step 1-2, оба спека упали до реализации)

- `DOCKER_HOST=unix://~/.orbstack/run/docker.sock pnpm --filter @mymozhem/core test:int -- rewards.int-spec` → **1 failed, 7 passed, 8 total**:
  `● award.prize по анонимизированному гостю отклоняется IDENTITY_ANONYMIZED… — Received promise resolved instead of rejected` (award вставился, гарды нет).
- `pnpm --filter @mymozhem/core test -- http-exception.filter.spec` → **1 failed, 36 passed, 37 total**:
  `● identity anonymized → typed wire error… — expect(reply.status).toHaveBeenCalledWith(409)` (нет маппинга → INTERNAL_ERROR/500).

## GREEN (Step 4-5, все прогоны)

- `test:int -- rewards.int-spec` → **PASS, 8/8** (включая новый C-8.1 кейс, 14 ms).
- `test -- http-exception.filter.spec` → **PASS, 37/37**.
- `test:int -- guest-sweep.int-spec` (регрессия связки свип/award, Task 2) → **PASS, 5/5**.
- `pnpm build` → 6 successful, 6 total (turbo).
- `pnpm run boundary-check` → no dependency violations (710 modules, 2216 deps).

## Deviations

- Тестовый кейс использует фактический хелпер файла `guest()` вместо inline `seedIdentity(db.prisma, { kind: 'GUEST' })` и хелпер `prizeEffect(prize.id, winnerId)` вместо inline-литерала эффекта — бриф явно разрешил поправить привязку к существующим хелперам, не смысл. Семантика идентична: seed гостя → `identity.update({ deletedAt: now })` → rejects `{ code: 'IDENTITY_ANONYMIZED' }` → quantity == 1, award count == 0.
- Иных отклонений нет; `award.points` (PointsGrant) гардой сознательно не покрыт (примечание брифа).

## Concerns

- Нет. Побочный эффект по замыслу: гарда бросает и на неизвестной identity (`winner === null`) — раньше это был бы FK-аборт транзакции (P2003/25P02-яд), теперь типизированный откат; это закреплено текстом ошибки («anonymized or unknown») и комментарием брифа.
