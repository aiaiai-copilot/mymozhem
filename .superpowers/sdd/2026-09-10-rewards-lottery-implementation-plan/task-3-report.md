# Task 3 report — SDK: AppEffect, AppPublishResult, хост-примитивы ctx, REWARDS_EVENTS, REST DTO rewards

## Что реализовано

**SDK (контракт 1.6.0):**
- `packages/sdk/src/app-runtime/app-effect.ts` — `awardPrizeEffectSchema` / `awardPointsEffectSchema` / `appEffectSchema` (discriminatedUnion по `kind`, strictObject; points строго положительные int — REQ-RWD-002a) + `AppEffect`. Фикстуры и контрактный spec (`app-effect.fixtures.ts`, `app-effect.contract.spec.ts`).
- `packages/sdk/src/app-runtime/app-publish-result.ts` — `AppPublishResult { commits, effects }` + `normalizePublishResult` (обратная совместимость: «голый массив» → `{ commits, effects: [] }`).
- `packages/sdk/src/app-runtime/app-host-context.ts` — `DrawPoolEntry` + `AppHostContext<S>` += `randomInt` (над node:crypto, REQ-RWD-011) и `drawPool` (наполнение — Task 7).
- `packages/sdk/src/app-runtime/app-runtime-module.ts` — сигнатура `handlePublish`: `AppCommit[] | AppPublishResult | Promise<...>`.
- `packages/sdk/src/events/rewards-events.ts` — `REWARDS_NAMESPACE`, `REWARDS_EVENTS` (reward.awarded/fulfilled/revoked, public v1, payload'ы только id — REQ-SEC-009, nullable prizeId — REQ-RWD-002b), `RewardsEventName`, `rewardsEventType` + контрактный spec.
- `packages/sdk/src/rewards/` — `createPrizeRequestSchema` (name 1..200, quantity int 1..10000), `prizeResponseSchema`, `awardResponseSchema` (enum AWARDED/FULFILLED/REVOKED — CLAIMED отложен по ADR-007), `listRewardsResponseSchema` + общий spec `rewards-dto.contract.spec.ts`.
- `packages/sdk/src/index.ts` — barrel-экспорты ровно по списку брифа.

**Core (минимальная адаптация, исполнение — Task 7):**
- `packages/core/src/app-runtime/app-runtime.service.ts` — импорты `node:crypto.randomInt`, `appEffectSchema`, `normalizePublishResult`; ctx += `randomInt`/`drawPool: []`; нормализация возврата `handlePublish`; валидация эффектов (`EVENT_PAYLOAD_INVALID` на malformed — баг модуля); fail-closed `CAPABILITY_UNAVAILABLE` на любых эффектах до появления исполнителя (коммитов не было).

**app-quiz (только typecheck-заглушки в spec):**
- `packages/app-quiz/src/quiz-handlers.spec.ts` — ctx-хелпер += `randomInt: () => 0`, `drawPool: []`. Поведение не меняется.

**Дополнительно (по строке Files «Test: app-runtime.int-spec.ts»):**
- `packages/core/src/app-runtime/app-runtime.int-spec.ts` — `EffectEmittingRuntime` (форма контракта 1.6.0, композиция над TestAppRuntime) + тесты 10 (валидный эффект → `CAPABILITY_UNAVAILABLE`, лог пуст) и 11 (malformed-эффект → `EVENT_PAYLOAD_INVALID`, лог пуст).

## Тесты и результаты

- `pnpm --filter @mymozhem/sdk test` — 26/26 suites, 313 tests PASS.
- `pnpm build` — 4/4 (sdk → core → app-quiz → server).
- `pnpm --filter @mymozhem/core test` — 18/18, 215 PASS.
- `pnpm --filter @mymozhem/app-quiz test` — 3/3, 83 PASS.
- `pnpm --filter @mymozhem/core test:int` — 16/16 suites, 161 tests PASS (testcontainers).
- `pnpm --filter @mymozhem/server test` — 5/5, 58 PASS (e2e).
- Полный гейт батча A: `pnpm lint` (4/4), `pnpm boundary-check` (no violations, 553 modules), `pnpm guardrails` (all alive), `pnpm test` (turbo, 7/7), `pnpm test:int` (turbo, 4/4) — всё зелёное.

## TDD evidence

**RED (SDK, Step 3):** `pnpm --filter @mymozhem/sdk test` после написания spec-файлов до реализации — 3 suites failed (TS2307: `Cannot find module './app-effect'`, `'./rewards-events'`, `'./create-prize-request'` и др.), 23 passed. Ожидаемо: модули ещё не существуют.

**GREEN (SDK):** та же команда после Step 4 — 26/26 suites, 313 tests PASS.

**RED (core, мутационный прогон):** тесты 10/11 int-spec добавлены к уже написанной реализации (бриф не предусматривал RED-шага для core). Для честного RED оба новых блока проверок эффектов в `dispatchLocked` были временно заменены на `void effects;` — `pnpm --filter @mymozhem/core test:int -- app-runtime.int-spec` дал ровно 2 failed (тесты 10 и 11: `err` = undefined, отказа нет), 12 passed. После восстановления реализации — 14/14 PASS в файле, полный int-прогон 161/161.

## Изменённые файлы

Созданы: sdk `app-effect.ts` (+fixtures/spec), `app-publish-result.ts`, `events/rewards-events.ts` (+spec), `rewards/{create-prize-request,prize-response,award-response,list-rewards-response}.ts` (+общий spec).
Изменены: sdk `app-host-context.ts`, `app-runtime-module.ts`, `index.ts`; core `app-runtime.service.ts`, `app-runtime.int-spec.ts`; app-quiz `quiz-handlers.spec.ts`.

## Отклонения от брифа

1. **Watch-item `Array.isArray` сузился не сразу, а на `tsc` build.** ts-jest (sdk test) пропустил, но `pnpm --filter @mymozhem/sdk build` упал с TS2322: `Array.isArray` не сужает `readonly AppCommit[]`. Минимальная правка, сохраняющая семантику брифа: сужение вынесено в тип-предикат `isCommitArray(result): result is readonly AppCommit[]`, тернарник использует его. Зафиксировано комментарием в коде.
2. **Int-spec тесты 10/11** добавлены сверх пошаговых инструкций — по строке Files брифа («Test: app-runtime.int-spec.ts — нормализация старой формы + отказ эффектов»). Нормализация старой формы покрыта всеми существующими тестами (TestAppRuntime возвращает голый массив). В тесте 10 identityId заменён на RFC 4122-uuid (`00000000-0000-4000-8000-…`): сидовый P1 имеет version-нибл 0 и не проходит `z.uuid()` zod v4 — обнаружено прогоном, а не догадкой. `EffectEmittingRuntime` — композиция, не наследование: override `handlePublish` сужал бы возврат базового класса (TS-ошибка), плюс `as unknown as` для намеренно malformed-эффекта с поясняющим комментарием.

## Самопроверка (дифф прочитан целиком)

- Полнота: все файлы брифа на месте; barrel — ровно строки брифа (fixtures app-effect не экспортируются — как в брифе).
- YAGNI: ничего сверх брифа + два теста из строки Files; `drawPool`/`randomInt` — заглушки, исполнение не забегает вперёд (Task 7).
- Тесты проверяют реальное поведение: схемы accept/reject, wire-тип `rewards.reward.awarded`, fail-closed пути диспетчера с проверкой пустого лога.
- Pristine output: мутация для RED восстановлена (финальный файл идентичен состоянию до мутации), бэкап в /tmp удалён; `git status` после коммита чист.
- Границы: app-quiz тронут только в spec; `@mymozhem/sdk` остаётся листом; boundary-check зелёный.

## Замечания

- Различие поведения ts-jest и `tsc -p` (watch-item проявился только на build) — стоит помнить в следующих задачах: sdk test не заменяет sdk build как проверку типов.
- Коммит: `5729fb2 feat(sdk,core): эффекты и хост-примитивы контракта 1.6.0 …`. Push не выполнялся (по правилам). Это конец Batch A — следующий срез новой сессией.
