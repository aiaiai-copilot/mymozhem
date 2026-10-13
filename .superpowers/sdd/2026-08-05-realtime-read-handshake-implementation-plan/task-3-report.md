# Task 3 report: Таблица маппинга core→contract кодов

**Status:** DONE
**Commit:** df4746526ce2508ec8406029edb490465c3a078d (`feat(core): таблица маппинга core→contract кодов event-commit (design §3)`)
**Branch:** feat/realtime-read-handshake

## Pre-flight

- Branch verified: `feat/realtime-read-handshake`, clean tree (кроме untracked `AGENTS.md`, не трогал).
- SDK dist проверен до написания теста: все 7 целевых contract-кодов присутствуют в `packages/sdk/dist/errors/` (включая `ACTOR_NOT_MEMBER` и `EVENT_RATE_LIMITED` из Task 2, версия пакета 1.2.0). Пересборка SDK не потребовалась.
- `realtime.errors.ts` прочитан: core-имена не переименовывал (решение владельца).

## Step 1 — failing test

Создан `packages/core/src/realtime/error-mapping.spec.ts` — код взят из брифа verbatim (таблица EXPECTED из 7 строк, `it.each` по маппингу, тест полноты покрытия, `it.each` валидации через `contractErrorCodeSchema`).

## Step 2 — verify red

Команда: `pnpm --filter @mymozhem/core test error-mapping` (фильтр без `--`).

Результат: FAIL, как ожидалось. Jest подхватил ровно 1 suite (`src/realtime/error-mapping.spec.ts`, >0 matched — фильтр корректен), падение на TS2307 `Cannot find module './error-mapping'`, 0 тестов выполнено. Причина красного — отсутствие модуля, не что-то иное.

## Step 3 — implementation

- Создан `packages/core/src/realtime/error-mapping.ts` — verbatim из брифа: `CONTRACT_CODE_BY_CORE_CODE` с `as const satisfies Record<RealtimeErrorCode, ContractErrorCode>` (полнота принуждается компилятором), экспорт `contractCodeFor(error: RealtimeError): ContractErrorCode`.
- `EVENT_EMIT_RATE_LIMITED` → `EVENT_RATE_LIMITED` (НЕ `RATE_LIMITED`), как предписано.
- В `packages/core/src/realtime/realtime.errors.ts` обновлены только комментарии: header (строки 1–3) и комментарий паритета (строки 9–10) — оба блока заменены точно по тексту брифа. Код ошибок не тронут.

## Step 4 — verify green

Команда: `pnpm --filter @mymozhem/core test error-mapping`.

Результат: PASS — 1 suite, **15 tests passed, 15 total**:
- 7 × maps `<core> → <contract>` (все строки таблицы),
- 1 × covers every core code exactly once,
- 7 × target `<code>` is a valid contract code.

## Step 5 — commit

`git add` трёх файлов из брифа, commit с точным сообщением из брифа + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Хеш: `df47465`. 3 files changed, 54 insertions(+), 4 deletions(-).

## Deviations

1. **Количество тестов: 15, а не 17.** Бриф в Step 4 ожидал «PASS (17 тестов)». Фактическая арифметика spec-файла из брифа: 7 (маппинг) + 1 (полнота) + 7 (валидность) = 15. Расхождение в ожидании брифа, не в коде — spec скопирован verbatim, все тесты зелёные. На функциональность и гейты не влияет.
2. Других отклонений нет: код из брифа использован дословно, тронуты только названные файлы.

## Concerns

- Нет. Компиляторная полнота (`satisfies Record<RealtimeErrorCode, ContractErrorCode>`) проверена косвенно: type-check прошёл внутри ts-jest прогона. Глобальные гейты (lint/type-check всего пакета) — зона Task 9.
