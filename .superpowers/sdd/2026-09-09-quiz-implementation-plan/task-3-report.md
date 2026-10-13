# Task 3 report: SDK — `clientInitiated` в манифесте событий

**Status:** DONE
**Commit:** `2d4c39c` feat(sdk): манифест — обязательный clientInitiated на тип события (design 2026-09-09 §2)

## Что реализовано

- `manifestEventSchema` (packages/sdk/src/manifest/manifest.schema.ts): добавлено обязательное `clientInitiated: z.boolean()` — в strictObject, рядом с обязательным `visibility`.
- `AppDefinition.events` (packages/sdk/src/manifest/define-app.ts): entry-тип расширен `clientInitiated: boolean`; маппинг в `defineApp` проносит флаг в зарегистрированный манифест.
- Фикстуры: `manifest.fixtures.ts` — `answer.submitted: true`, `round.opened: false` (производный тип, с комментарием); добавлена невалидная фикстура «event definition misses clientInitiated»; прочие невалидные кейсы с инлайн-литералами событий получили `clientInitiated`, чтобы каждый падал ровно по своей причине.
- Все манифест-литералы в репо (найдены `grep -rln "manifestVersion"` + `grep "contractRange: '"`):
  - `apps/server/test/realtime.e2e-spec.ts` — TEST_APP: `note.posted`/`round.hinted`/`secret.recorded` — все `clientInitiated: true` (публикуются e2e напрямую).
  - `packages/core/src/realtime/event-commit.int-spec.ts` — TEST_APP: `note.posted` true, `secret.recorded` true.
  - `packages/core/src/realtime/event-outbox.int-spec.ts` и `packages/core/src/realtime/db-down.int-spec.ts` — TEST_APP: `note.posted` true (этих двух файлов не было в явном списке брифа, но grep их нашёл — без правки typecheck упал бы).
- Не тронуто (проверено grep'ом — не манифест-литералы): `event-log.int-spec.ts`, `room.service.int-spec.ts` (только ассерты visibility), `projection.service.spec.ts` (`events: {}` — пусто), `core-events.ts` (core-реестр, другой тип `EventTypeDefinition`), app-registry сервисы/спеки (используют SDK-фикстуры), `define-app.fixtures.ts` (только схемы, без событий).

## TDD evidence

### RED (Step 2)

Команда: `pnpm --filter @mymozhem/sdk test -- manifest`

Результат: FAIL — 2 suite'а не компилируются (ts-jest): `TS2353: Object literal may only specify known properties, and 'clientInitiated' does not exist...` в `define-app.contract.spec.ts` (строки 23, 103, 104, 141) и в фикстурах; `manifest.contract.spec.ts` также упал. `Test Suites: 2 failed, 1 passed`.

### GREEN (Step 4)

- `pnpm build` — 3/3 successful (sdk, core, server; dist SDK обновлён — core/server тесты резолвят SDK из dist).
- `pnpm --filter @mymozhem/sdk test` — PASS: 22 suites, 268 tests.
- `pnpm --filter @mymozhem/core test` — PASS: 16 suites, 207 tests.
- `pnpm --filter @mymozhem/server test` — PASS: 4 suites, 49 tests (включая realtime.e2e).
- `pnpm typecheck` — PASS (5/5 tasks, всё дерево).
- `pnpm lint` — PASS (3/3).

Интеграционные тесты (`test:int`) не запускались — по брифу, это Task 6/7. Изменённые int-spec файлы покрыты typecheck.

## Self-review (diff прочитан построчно)

- Diff минимален: 8 файлов, +43/−6. Никаких изменений вне объявленного скоупа.
- Значения флага соответствуют семантике брифа: валидная SDK-фикстура демонстрирует обе ветки (true/false), тестовые манифесты ядра/server — true (прямой publish).
- Новый контрактный тест — verbatim из брифа; ассерты на `?.clientInitiated` проходят.
- Комментарий в схеме зафиксировал, что гейт — в app-runtime диспетчере (Task 6), здесь только данные.

## Concerns

- Нет. Поле чисто аддитивно для ядра: `getEventDefinition`/пайплайн коммита его пока не читают (гейт — Task 6), typecheck и все тесты зелёные.
