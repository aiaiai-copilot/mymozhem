# Task 2 Report: SDK — контракт 1.6.0 + capabilities манифеста + wire-коды фазы 3

## What I implemented

1. **`CONTRACT_VERSION` = `'1.6.0'`** в `contract-version.ts` + `"version": "1.6.0"` в `packages/sdk/package.json` (parity проверяется существующим контрактным тестом — зелёный).
2. **7 новых wire-кодов** в `CONTRACT_ERROR_CODES` (перед `INTERNAL_ERROR`, с комментарием про фазу 3): `ROOM_NOT_ACTIVE`, `CAPABILITY_UNAVAILABLE`, `PRIZE_UNKNOWN`, `PRIZE_FUND_EXHAUSTED`, `DRAW_POOL_EMPTY`, `AWARD_UNKNOWN`, `REWARD_ALREADY_RESOLVED`. Тип `ContractErrorCode` и `contractErrorCodeSchema` выводятся из массива — новые коды попадают в оба автоматически.
3. **Capabilities манифеста** в `manifest.schema.ts`: `APP_CAPABILITIES = ['rewards'] as const`, `appCapabilitySchema = z.enum(APP_CAPABILITIES)`, тип `AppCapability`; поле `capabilities: z.array(appCapabilitySchema).optional()` в `appManifestSchema`. Комментарий про «strictObject отклонит capabilities до фазы 3» переписан под новое поведение. Все три символа попадают в публичный API через существующий `export * from './manifest/manifest.schema'` в `index.ts`.
4. **`AppDefinition.capabilities?: readonly AppCapability[]`** в `define-app.ts` + spread при сборке манифеста (копия массива, чтобы не отдать наружу ссылку на входной readonly-массив).
5. **Фикстуры**: из `invalidManifestCases` убран кейс «manifest carries a capabilities field»; в `validManifests` добавлен манифест `lottery` с `capabilities: ['rewards']`; в `invalidManifestCases` добавлен кейс `unknown capability value` (`['teleport']`).

## TDD Evidence

### RED (Step 3)

Command: `pnpm --filter @mymozhem/sdk test`

Result: `Test Suites: 3 failed, 20 passed, 23 total; Tests: 8 failed, 254 passed`.

Failing output (репрезентативно):
- 7 падений `accepts phase-3 code %s` — `Expected: true / Received: false` (коды отсутствуют в `CONTRACT_ERROR_CODES`).
- `app manifest contract › accepts a manifest with known capabilities` — `Expected: true / Received: false` (strictObject отклоняет `capabilities`).
- `define-app.contract.spec.ts` — suite не собирается: `TS2353: 'capabilities' does not exist in type 'AppDefinition'`.

Всё падения ожидаемы: тесты писались первыми под несуществующее поведение.

### GREEN (Step 5)

Command: `pnpm --filter @mymozhem/sdk test`

Result: `Test Suites: 23 passed, 23 total; Tests: 292 passed, 292 total`, включая parity-тест `equals the SDK package version`.

Дополнительно: `pnpm --filter @mymozhem/sdk build`, `lint`, `typecheck` — все чисто.

## Files changed

- `packages/sdk/package.json` (version 1.5.0 → 1.6.0)
- `packages/sdk/src/contract-version.ts` (CONTRACT_VERSION 1.5.0 → 1.6.0)
- `packages/sdk/src/contract-version.contract.spec.ts` (см. ниже)
- `packages/sdk/src/errors/error-codes.ts` (7 новых кодов)
- `packages/sdk/src/errors/error-codes.contract.spec.ts` (it.each фазы 3 + обновлён точный список кодов)
- `packages/sdk/src/manifest/manifest.schema.ts` (APP_CAPABILITIES / appCapabilitySchema / AppCapability + поле в схеме)
- `packages/sdk/src/manifest/manifest.contract.spec.ts` (3 новых теста capabilities)
- `packages/sdk/src/manifest/define-app.ts` (поле в AppDefinition + spread)
- `packages/sdk/src/manifest/define-app.contract.spec.ts` (тест проброса capabilities)
- `packages/sdk/src/manifest/manifest.fixtures.ts` (валидный lottery-манифест; кейс отказа переписан на unknown value)

## Step 4 grep: capability-rejection tests

`grep -rn "capabilities" packages/sdk/src --include="*.spec.ts"` — **пусто**. Ни одного теста, фиксирующего отказ поля `capabilities`, в spec-файлах нет; отказ фиксировался только фикстурой `invalidManifestCases` в `manifest.fixtures.ts` (строки 92-95), которая переписана на кейс `unknown capability value` по брифу.

## Отклонение от брифа (вынужденное)

`contract-version.contract.spec.ts:30` пинил `>=1.6.0` как *несовместимый* диапазон — при CONTRACT_VERSION = 1.5.0 это было верно; после поднятия до 1.6.0 диапазон стал удовлетворяемым и тест упал. Заменил пин на `>=1.7.0` — тест по-прежнему проверяет «диапазон, исключающий текущую версию контракта, отклоняется». Это тот же класс правки, что и при прошлых версионных подъёмах.

## Self-review findings

- Полнота: все пункты брифа Steps 1-5 выполнены; exact-list тест кодов обновлён синхронно с массивом (иначе GREEN был бы невозможен — это неявная, но необходимая часть Step 4).
- YAGNI: ничего сверх брифа; новые символы экспортируются существующим `export *`, index.ts не тронут.
- Тесты проверяют реальное поведение: приём известного capability, отказ неизвестного, опциональность поля, проброс через defineApp, приём каждого из 7 кодов, отказ неизвестного кода (существующий `KABOOM`-тест).
- Глобальный grep `1.5.0` по `packages/` и `apps/` — других пинов версии нет; bump не ломает остальные пакеты.
- Чистота: build/lint/typecheck зелёные, diff содержит только релевантные изменения.

## Issues / concerns

Нет.
