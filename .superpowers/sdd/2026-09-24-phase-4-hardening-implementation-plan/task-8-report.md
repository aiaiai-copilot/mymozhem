# Task 8 — Отчёт: миграция логирования на pino + корреляция (REQ-OPS-004)

Дата: 2026-09-25. Исполнитель: implementer-subagent (takeover после остановки предыдущего исполнителя на середине работы).

## Audit of predecessor's changes

Аудит делался по `git diff` (16 изменённых файлов) против брифа `task-8-brief.md` и рулингов takeover-брифа (C-pre.1 и др.).

### Production-файлы (5 точек `new Logger`) — приняты без правок

- `packages/core/src/transport/http-exception.filter.ts` — OK. `PinoLogger` через конструктор + `setContext`; импорт из `../observability/pino-logger.module` (не `nestjs-pino` — C-pre.1 соблюдён); `getRequest<{ id?: string }>()`, `requestId` в 5xx error-логе (`{ requestId, err }`) и в Auth/OAuth warn-логе; комментарий про различие reuse/expired (design §11) сохранён.
- `packages/core/src/realtime/realtime.gateway.ts` — OK. Логгер — последний параметр конструктора (после `metrics`); операционные логи `socket connected` / `socket disconnected` / `subscribed`; `subscribed` строго после `ack` с полями `{ socketId, actorId, roomId, level }`; `fanOut` catch — `{ roomId, seq, type, err }` без payload (REQ-SEC-009); `wireCodeOf` — `{ err }`; `authenticate` warn с `{ socketId }`.
- `packages/core/src/identity/guest-sweep.service.ts` — OK. Успех: `{ anonymized, suspended }` info; откат C-8.1: `{ raced: err.racedCount }` warn с текстом по брифу.
- `packages/core/src/identity/identity-sweep.module.ts` — OK. GuestSweepScheduler на PinoLogger, `{ err }` error-лог; `PinoLoggerModule` уже был добавлен в `imports` предшественником.
- `packages/core/src/membership/membership.service.ts` — OK. Мигрирован только error-лог обработчика `onAccessRevoked`: текст сообщения сохранён, добавлены `{ identityId, roomId }`; новых логов нет.

### Спеки — приняты без правок

- `packages/core/src/realtime/realtime.gateway.spec.ts` — OK. `fakeLogger` проброшен последним аргументом `makeGateway`; новый тест корреляции (REQ-OPS-004/REQ-SEC-009) присутствует дословно по брифу. Легаси-тесты, заменяющие `(gateway as ...).logger` пост-конструкции (3 сайта: строки ~124, ~140, ~369), продолжают работать — `private readonly logger` из конструктора остаётся обычным свойством экземпляра, присваивание через каст валидно (проверено прогоном).
- `packages/core/src/transport/http-exception.filter.spec.ts` — OK. `makeFilter` конструирует фильтр с фейком, `makeHost` отдаёт `getRequest: () => ({ id: 'req-1' })`; шпионы `Logger.prototype` удалены; новый кейс requestId + переписанные ассерты warn/error.

### Int-specs и test-config — частично незавершено, исправлено мной

- `packages/core/src/testing/test-config.ts` — OK. Структурный no-op `fakeLogger` (`as unknown as PinoLogger`, импорт типа из observability-модуля — C-pre.1 соблюдён).
- `packages/core/src/realtime/event-outbox.int-spec.ts` — НЕЗАВЕРШЕНО: импорт `fakeLogger` добавлен, но аргумент в `new MembershipService(...)` (строка 71) не проброшен (unused import + неверная сигнатура). Исправлено: добавлен `fakeLogger` последним аргументом.
- `packages/core/src/membership/membership.service.int-spec.ts` — НЕЗАВЕРШЕНО: предшественник поправил только 1 из 4 сайтов `new MembershipService` (строка 57); сайты на строках 35 (`makeMembership`), 366 (`makeMembership2`) и 382 остались без `fakeLogger` — именно они упали в полном прогоне test:int (ts-jest TS2554). Исправлено: `fakeLogger` добавлен во все три.
- Остальные 6 int-spec (`app-runtime`, `token.service`, `db-down`, `event-commit` ×3 сайта, `event-log`, `room.service` ×2 сайта) — OK, минимальный DI-фикс (только импорт + последний аргумент).
- DI-деревья (`guest-sweep.int-spec.ts`, `rewards.int-spec.ts` и др., использующие `Test.createTestingModule`) правок не потребовали: nestjs-pino `LoggerModule` — `@Global`, после включения `PinoLoggerModule` в дерево `PinoLogger` резолвится транзитивно. Проверено прогоном.

### Модули (Step 5 брифа) — отсутствовали, добавлены мной

`PinoLoggerModule` в `imports` (импорт из `../observability/pino-logger.module`):
- `packages/core/src/identity/identity.module.ts` — добавлено.
- `packages/core/src/membership/membership.module.ts` — добавлено.
- `packages/core/src/realtime/realtime.module.ts` — добавлено.
- `packages/core/src/transport/transport.module.ts` — добавлено.
- `packages/core/src/identity/identity-sweep.module.ts` — было у предшественника.

## Собственная работа (после аудита)

1. Добавлен `PinoLoggerModule` в imports 4 модулей (см. выше).
2. Исправлен незавершённый сайт в `event-outbox.int-spec.ts`.
3. Исправлены 3 пропущенных сайта в `membership.service.int-spec.ts`.
4. Проверки рулингов: `grep "from 'nestjs-pino'"` вне `pino-logger.module.ts` — пусто (C-pre.1); `grep "new Logger"` в `packages/core/src` — пусто (все 5 точек мигрированы).

## Прогоны (все зелёные)

| Команда | Результат |
|---|---|
| `pnpm --filter @mymozhem/core typecheck` | PASS (tsc --noEmit, без вывода ошибок) |
| `pnpm --filter @mymozhem/core lint` | PASS (eslint src, чисто; финальный ре-ран после всех правок) |
| `pnpm run boundary-check` (корень worktree) | PASS — «no dependency violations found (729 modules, 2295 dependencies)» |
| `pnpm --filter @mymozhem/core test` | PASS — 20 suites / 240 tests, 5.1s |
| `pnpm --filter @mymozhem/core test:int` | Первый полный прогон: 22/23 suites (174 tests) — падение только `membership.service.int-spec.ts` (TS2554, 3 сайта). После фикса: `test:int -- membership.service.int-spec` → PASS, 40/40 tests, 8.1s (фильтр сматчил ровно 1 suite > 0). Остальные 22 suites зелёные в полном прогоне, где уже присутствовали все правки модулей и event-outbox. |

TDD-свидетельство: RED/GREEN-цикл спеков выполнен предшественником; перепроверено прогоном обоих сьютов (`realtime.gateway.spec.ts`, `http-exception.filter.spec.ts`) в составе полного unit-рана — PASS.

## Отклонения от брифа

- Step 7 брифа предлагает `git add` четырёх директорий; закоммичены также `packages/core/src/testing/test-config.ts` и int-spec в `app-runtime/`, `auth/`, `room/` — они неотделимы от изменения сигнатур конструкторов (иначе дерево не компилируется). Это соответствует takeover-брифу (int-spec правки — часть задачи).
- Сообщение коммита — дословно по Step 7 с добавленной строкой Co-Authored-By.
