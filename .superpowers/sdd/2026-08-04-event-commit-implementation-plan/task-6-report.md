# Task 6 Report: Rate-limit в цепочке — int-тесты

**Status:** DONE
**Commit:** 2794691 — `test(core): rate-limit семантика commitAppEvent — per-actor изоляция, null-actor, подсчёт попыток (REQ-RT-014)`
**Branch:** phase-1-event-commit

## Что сделано

Единственный изменённый файл: `packages/core/src/realtime/event-commit.int-spec.ts`

1. В импорт из `./realtime.errors` добавлен `EventEmitRateLimitedError` (Task 5 убрал его как тогда неиспользуемый).
2. Добавлен второй describe `EventLogService.commitAppEvent — rate limit (REQ-RT-014)` — код verbatim из task-6-brief.md. Сервис собирается с `EventEmitLimiter(3)` (малый лимит), комнаты/идентичности переиспользуют общие константы ORG/P1/P2/TEST_APP и хелперы первого describe.

Новые тесты (характеризующие семантики шага лимитера в commitAppEvent):

- `4th attempt in the window is rejected; other actor and null actor unaffected` — 4-я попытка P1 отклоняется `EventEmitRateLimitedError`; у P2 свой бюджет; null-actor (серверная эмиссия) вне per-actor лимита; в логе ровно 1 (activated) + 3 + 2 записей.
- `failed attempts burn the budget too (attempts counted, not just successes)` — 3 отказа по схеме (`EventPayloadInvalidError`) сжигают бюджет, 4-я валидная попытка уже отклоняется лимитером — то есть лимитер считает попытки, а не только успехи, и стоит ДО валидации payload.

## Результаты прогонов

| Прогон | Команда | Результат |
|---|---|---|
| Фильтр | `pnpm --filter @mymozhem/core test:int -t "rate limit"` (без `--`) | 2 passed, 98 skipped — фильтр матчит ровно оба новых теста |
| Unit (полный) | `pnpm --filter @mymozhem/core test` | 10 suites, 117 tests — все зелёные |
| Int (полный, testcontainers) | `pnpm --filter @mymozhem/core test:int` | 11 suites, 100 tests — все зелёные |
| Lint | `pnpm --filter @mymozhem/core lint` | чисто |

## Ключевое наблюдение

Оба новых теста прошли СРАЗУ, без изменений в реализации — как и ожидалось в brief (поведение поставлено Task 5). Багов в `commitAppEvent` не обнаружено: per-actor изоляция, null-actor вне лимита и подсчёт попыток (а не успехов) подтверждены характеризующими тестами.

## Concerns

Нет.
