# Task 2 Report: Конфиг — параметры §4 и ConfigModule

## What was implemented

- `config.schema.ts` (полная замена по brief): добавлены три §4-параметра на `AppConfig`:
  - `ROOM_CODE_MIN_LEN: number` — дефолт 8, min 6 (REQ-ID-013)
  - `ROOM_PARTICIPANT_LIMIT: number` — дефолт 500, диапазон 1…100 000 (REQ-ID-006)
  - `JOIN_RATE_LIMIT_IP: number` — дефолт 20, min 1 (REQ-ID-006)
  - Существующие поля `NODE_ENV`/`PORT`/`DATABASE_URL` сохранены verbatim.
- `config.tokens.ts` (новый): DI-токен `APP_CONFIG = Symbol('APP_CONFIG')`.
- `config.module.ts` (новый): `ConfigModule`, провайдит `APP_CONFIG` через `useFactory: () => loadConfig(process.env)`, экспортирует токен.
- `config.schema.spec.ts`: 6 новых тестов добавлены внутрь существующего `describe('loadConfig')` (1 defaults, 4 `it.each` на out-of-range, 1 coercion) — verbatim по brief.

Ничего сверх brief: никаких потребителей/экспортов из пакета не добавлялось (потребители — Tasks 3 и 5).

## TDD Evidence

### RED

Command: `pnpm --filter @mymozhem/core test -t "loadConfig"`

Result: FAIL — Test suite failed to run, TS2339: `Property 'ROOM_CODE_MIN_LEN' does not exist on type '{ NODE_ENV; PORT; DATABASE_URL }'` (и аналогично для `ROOM_PARTICIPANT_LIMIT`, `JOIN_RATE_LIMIT_IP`), 5 ошибок в spec-файле. Это ожидаемый RED: ts-jest типизирует spec, поэтому отсутствие полей на `AppConfig` ловится на этапе компиляции теста (эквивалент ожидаемого brief'ом «`cfg.ROOM_CODE_MIN_LEN` is `undefined`»).

### GREEN

Command: `pnpm --filter @mymozhem/core test -t "loadConfig"`

Result: PASS — `Tests: 58 skipped, 10 passed, 68 total`. 10 = 4 существующих + 6 новых (brief ожидал «7 тестов describe» — это было отмечено как приблизительно; реальный счёт 10 в describe, расхождение только в счёте, не в покрытии).

## Gates

`pnpm --filter @mymozhem/core lint && pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core test`:

- eslint: clean, без вывода ошибок.
- tsc --noEmit: clean.
- Full suite: `Test Suites: 5 passed, 5 total; Tests: 68 passed, 68 total`.

## Files changed

- `packages/core/src/config/config.schema.ts` (modified)
- `packages/core/src/config/config.tokens.ts` (created)
- `packages/core/src/config/config.module.ts` (created)
- `packages/core/src/config/config.schema.spec.ts` (modified)

Commit: `e4d8b64 feat(core): §4 join/code/participant config params + ConfigModule (REQ-OPS-003)` (4 files changed, 48 insertions, 2 deletions) на ветке `phase-1-membership-guest-join`.

## Self-review findings

- Дефолты и границы сверены с brief verbatim: 8/≥6, 500/1…100 000 (`.max(100_000)`), 20/≥1.
- Out-of-range тесты покрывают обе границы для `ROOM_PARTICIPANT_LIMIT` (0 и 100 001).
- Токен `APP_CONFIG` — `symbol`, как указано; ConfigModule не импортируется нигде вне своего файла (wiring — Task 6), что соответствует YAGNI-ограничению brief.
- `config.module.ts` импортирует `@nestjs/common` — зависимость уже есть в пакете (typecheck/lint зелёные).

## Issues or concerns

Нет. Расхождение «7 vs 10 тестов» — только счёт (brief помечал его как приблизительный).
