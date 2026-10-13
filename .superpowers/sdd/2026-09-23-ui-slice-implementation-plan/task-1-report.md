# Task 1 Report: SDK io:'input' (P1, C-9.1) → SDK 1.7.0

## What was implemented

1. **`toRegisteredSchema` теперь конвертирует в `io: 'input'`** (`packages/sdk/src/manifest/define-app.ts`): defaulted ключи appSettings не попадают в `required` зарегистрированного JSON-Schema артефакта — configure `{}` проходит verdict-only гейт ядра; дефолт применяет zod-parse в handler'е модуля (решение владельца C-9.1, REQ-RWD-014). Комментарий из брифа внесён.
2. **Новый отказ guard'а: pipe (.transform()/.pipe())** — см. «Issues» ниже. В io:'input' zod перестал бросать на transform и стал МОЛЧА эмитить только входную сторону pipe (transform и post-transform валидация исчезают). Это класс молчаливой потери ADR-008; добавлен детектор `isUnrepresentablePipe` (по `_zod.def.type === 'pipe' | 'transform'`, fail-closed — отклоняется любой pipe) + русские why-комментарии; doc-комментарий guard'а обновлён под новую реальность.
3. **Контракт 1.7.0**: `CONTRACT_VERSION = '1.7.0'` и `packages/sdk/package.json version = 1.7.0` (паритет пинится `contract-version.contract.spec.ts`).
4. **Тесты** (TDD): SDK-спека «defaulted settings key is optional in the registered artifact (io: input, C-9.1)» — verbatim из брифа; core-спека «accepts {} when every settings key is defaulted (C-9.1 end-to-end на гейте)» с локальной фикстурой `fixtureManifestWithDefaultedSettings` в форме зарегистрированного input-артефакта.

## What was tested and results

- `pnpm --filter @mymozhem/sdk test` — 26 suites / 314 tests, зелёный.
- `pnpm --filter @mymozhem/sdk build` — зелёный (core резолвит sdk из dist).
- `pnpm --filter @mymozhem/app-lottery test` — 34, зелёный; `pnpm --filter @mymozhem/app-quiz test` — 86, зелёный.
- `pnpm --filter @mymozhem/core test -- app-registry.service` — 16, зелёный.
- Полный unit конвейер `pnpm build && pnpm run test` (turbo): **9/9 tasks успешно** — sdk 314, core 224, app-quiz 86, app-lottery 34, server 67 (725 тестов). Интеграционные testcontainers (`test:int`) не запускались — в `test` они не входят.
- Гейты: `lint` + `typecheck` (sdk/core/app-lottery) зелёные; `pnpm boundary-check` — no dependency violations (611 modules).

## TDD Evidence

### RED

`pnpm --filter @mymozhem/sdk test -- define-app` после добавления теста Step 1 (до реализации):

```
● defineApp › defaulted settings key is optional in the registered artifact (io: input, C-9.1)
  Array [
+   "mode",
    "requiredKey",
  ]
Tests: 1 failed, 29 passed, 30 total
```

Ожидаемо: output-режим z.toJSONSchema помещает defaulted ключ `mode` в `required` — ровно дефект C-9.1.

Промежуточный RED после добавления `io:'input'` (до pipe-детектора): существующая фикстура guard'а `.transform()` перестала бросать («Expected constructor: ContractError, Received function did not throw») — zod в input-режиме молча эмитит входную сторону pipe. Это вскрыло необходимость собственного отказа (см. Issues).

### GREEN

После `io: 'input'` + `isUnrepresentablePipe`: `pnpm --filter @mymozhem/sdk test -- define-app` — 30/30 passed. Полный sdk suite — 314/314. Core-спека Step 5 зелёная сразу (бриф это предвидел: гейт читает тот же артефакт) — оставлена как пин end-to-end поведения на гейте.

## Files changed (commit 71d72c0, branch ui-slice)

- `packages/sdk/src/manifest/define-app.ts` — io:'input'; isUnrepresentablePipe; обновлённые why-комментарии (guard doc, catch).
- `packages/sdk/src/manifest/define-app.contract.spec.ts` — новый тест Step 1 (verbatim из брифа).
- `packages/sdk/src/contract-version.ts` — CONTRACT_VERSION 1.7.0.
- `packages/sdk/package.json` — version 1.7.0.
- `packages/sdk/src/contract-version.contract.spec.ts` — версиозависимый кейс `>=1.7.0` → `>=1.8.0` (тот же класс «несовместимый диапазон» при новой версии контракта).
- `packages/core/src/app-registry/app-registry.service.spec.ts` — фикстура + тест Step 5; импорт `type AppManifest`.
- `packages/app-lottery/src/lottery-manifest.contract.spec.ts` — пин output-режима flipped: «rejects an empty settings snapshot» → «accepts an empty settings snapshot (drawEligibility defaulted, optional in the registered schema)», комментарий переписан под io:'input'.

## Self-review findings

- Diff минимален и по делу; app-quiz не потребовал изменений (нет defaulted ключей и пинов `required` в артефакте).
- Тесты проверяют поведение через публичные API (defineApp, validateSettings), не внутренности; вывод чистый.
- Новые комментарии — на русском, объясняют почему (C-9.1, ADR-008, fail-closed); doc-комментарий guard'а переписан целиком, чтобы не было смешения языков внутри предложения.
- YAGNI: pipe-детектор — не золотое покрытие, а восстановление существующего контрактного отказа, сломанного сменой режима zod (существующая фикстура `.transform()` его пинит).

## Issues / concerns

1. **Неучтённый fallout брифа — `.transform()`.** Бриф предупреждал только о спеках quiz/lottery, но `io:'input'` молча меняет поведение zod на pipe: раньше zod сам бросал «Transforms cannot be represented», теперь эмитит входную сторону и ТЕРЯЕТ transform + post-transform валидацию (`.pipe(z.number().min(2))` — min(2) исчезает; хуже `.refine()`: zod-parse модуля упал бы на данных, принятых гейтом). Решение: сохранить отказ своим детектором (`isUnrepresentablePipe`, fail-closed — любой pipe, включая валидационные цепочки без transform, чьи output-чеки в input-режиме теряются так же). Существующая фикстура `.transform()` в `define-app.fixtures.ts` пинит детектор от апгрейдов zod — тот же принцип, что у guard'а чеков. Поведенческий контракт для авторов не изменился: transform был и остаётся отказом SCHEMA_NOT_REPRESENTABLE.
2. **`contract-version.contract.spec.ts` содержал версиозависимый кейс** `>=1.7.0` как «несовместимый диапазон» — при бампе до 1.7.0 он стал совместимым; заменён на `>=1.8.0`. Это recurring-правка при каждом minor-бампе (уже было при 1.6.0); не блокер, но стоит знать.
3. Core-тест Step 5 зелёный сразу (ожидаемо по брифу Step 6) — гейт читает тот же артефакт; тест оставлен как пин.
