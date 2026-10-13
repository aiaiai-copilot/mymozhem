# Task 5 report: EventOutbox + RealtimeBus + staging в EventLogService + RoomService на runner

Status: DONE. Все гейты зелёные, один коммит.

## Step 1 — failing int-spec

Создан `packages/core/src/realtime/event-outbox.int-spec.ts` — verbatim из brief (6 тестов: доставка после коммита exactly-once, батчинг в один publish, откат → ничего, fail-closed в bare `$transaction`, nested run, lifecycle-доставка через RoomService.transition).

## Step 2 — red

`pnpm --filter @mymozhem/core test:int event-outbox` → FAIL как ожидалось: `TS2307: Cannot find module './realtime-bus'` и `'./event-outbox'` (+ каскад TS7006). Suite матчилась (1 test suite), 0 тестов выполнено — compile-level red по правильной причине.

## Step 3 — bus + outbox

- Создан `packages/core/src/realtime/realtime-bus.ts` — verbatim. `EventEmitter` — поле экземпляра (REQ-CORE-004).
- Создан `packages/core/src/realtime/event-outbox.ts` — verbatim. ALS — поле экземпляра; `run()` бросает `EventOutboxNestedRunError` при вложенности, flush в шину строго после resolve `$transaction`; `stage()` вне контекста → `EventOutboxMissingContextError` (fail-closed структурно).

## Step 4 — staging в EventLogService

`packages/core/src/realtime/event-log.service.ts`:
1. Импорт `EventOutbox` добавлен.
2. Конструктор: `outbox: EventOutbox` — 4-й параметр (после `config`).
3. В конце `appendLocked`: `this.outbox.stage(rows[0]); return rows[0];` с комментарием из brief.
4. Комментарий класса дополнен строкой про fail-closed staging.
Публичные сигнатуры `commitCoreEvent`/`commitAppEvent` НЕ менялись.

## Step 5 — RoomService.transition → outbox.run

`packages/core/src/room/room.service.ts`:
1. Импорт `EventOutbox`.
2. Конструктор: `outbox` — 3-й параметр (между `eventLog` и `appRegistry`).
3. В `transition`: `this.prisma.$transaction(async (tx) =>` → `this.outbox.run(async (tx) =>`; тело не тронуто. `create()` остаётся на `prisma.$transaction` — внутри нет коммитов событий, runner не нужен.

## Step 6 — RealtimeModule

`packages/core/src/realtime/realtime.module.ts` переписан целиком по brief: добавлен `PrismaModule` в imports (для EventOutbox), провайдеры `RealtimeBus`, `EventOutbox`; exports: `[EventLogService, EventOutbox]`. DI-граф проверен: RoomModule импортирует RealtimeModule → RoomService получает EventOutbox; EventOutbox получает PrismaService + RealtimeBus внутри RealtimeModule.

## Step 7 — barrel

`packages/core/src/index.ts`: после `export * from './realtime/realtime.module';` добавлены `export * from './realtime/realtime-bus';` и `export * from './realtime/event-outbox';` (экспортируют RealtimeBus, CommittedEventsListener, EventOutbox и обе ошибки).

## Step 8 — механическая правка (рецепт по каждому файлу)

| Файл | Рецепт | Что сделано |
|---|---|---|
| `packages/core/src/realtime/event-commit.int-spec.ts` | A + B + C | Импорты RealtimeBus/EventOutbox; в трёх describe — `outbox` поднят в `let` + создаётся в `beforeAll` (`new EventOutbox(db.prisma, new RealtimeBus())`); EventLogService получил outbox 4-м, RoomService — 3-м; все commit-обёртки `db.prisma.$transaction((tx) => …` → `outbox.run((tx) => …` (включая rate-limit `limitedLog` и конкурентные тесты). Намеренно оставлен `holdTx = db.prisma.$transaction(async (tx) => {…pg_advisory_xact_lock…})` в TOCTOU-тесте — это сырой lock-holder без коммитов, не под рецепт C. |
| `packages/core/src/realtime/event-log.int-spec.ts` | A + B + C | `outbox` в `beforeAll`, общий для обоих EventLogService (комнатного и тестового) и RoomService; все `$transaction`-обёртки коммитов → `outbox.run`. Bare `$transaction` не осталось (grep подтверждён). |
| `packages/core/src/room/room.service.int-spec.ts` | A + B | `makeService` превращён в блок с локальным `outbox`; inline `emptyRegistryService` в тесте «rejects activation when the pinned manifest is absent» получил собственный `emptyRegistryOutbox`. Коммиты — внутри transition (runner внутри сервиса), рецепт C неприменим. |
| `packages/core/src/membership/membership.service.int-spec.ts` | A + B | Конструирует RoomService + EventLogService inline → добавлены импорты, локальный `outbox` в `beforeAll`, аргументы. |
| `packages/core/src/auth/token.service.int-spec.ts` | A + B | Аналогично: конструирует RoomService + EventLogService → те же правки. |
| `apps/server/test/transport.e2e-spec.ts` | A + B | Импорты `EventOutbox`, `RealtimeBus` из barrel `@mymozhem/core`; локальный `outbox` в `beforeAll`; оба `new AppRegistryService([])` сохранены как было. |
| `apps/server/scripts/create-room.mjs` | B-эквивалент | Subpath-импорты из dist (`realtime-bus.js`, `event-outbox.js`, `event-emit-limiter.js`) по существующей конвенции workaround'а; сборка `registry → outbox(new RealtimeBus) → eventLog(4 аргумента) → rooms(6 аргументов, outbox 3-й)`. Скрипт вызывает только `rooms.create()` — вызовы transition отсутствуют, правка вызовов не нужна (runner внутри RoomService). |

### Deviation (minor)

`create-room.mjs` раньше конструировал `new EventLogService()` вообще без аргументов (инертно: скрипт не эмитит события). Чтобы граф конструкторов был когерентен с новой 4-аргументной сигнатурой, EventLogService заполнен реальными зависимостями (`registry`, `EventEmitLimiter(config.EVENT_EMIT_RATE_LIMIT_PER_MIN)`, `config`, `outbox`) вместо передачи `undefined`. Поведение скрипта (только create) не изменилось.

## Step 9 — гейты

1. `pnpm build` → 3/3 packages successful (sdk, core, server), 3.3s.
2. `pnpm --filter @mymozhem/core test:int event-outbox` (green-проверка новой спеки) → PASS, 6/6.
3. `pnpm --filter @mymozhem/core test:int` → 12 suites / 112 tests, все PASS (54s; testcontainers поднялись штатно, чужой контейнер `lt-pg` на 5432 не тронут).
4. `pnpm --filter @mymozhem/server test` → 2 suites / 15 tests PASS (build был выполнен до этого шага — e2e резолвит core из dist).
5. `pnpm --filter @mymozhem/core test` → 12 suites / 141 tests PASS.

## Step 10 — commit

`git add packages/core/src apps/server/test/transport.e2e-spec.ts apps/server/scripts/create-room.mjs` + commit с сообщением из brief и трейлером Co-Authored-By.

## Замечания

- Проверка полноты списка файлов: grep по `new EventLogService|new RoomService` и `commitAppEvent|commitCoreEvent` подтвердил, что все construction-сайты и commit-обёртки покрыты списком brief; пропущенных мест нет.
- Fail-closed проверен тестом: коммит в bare `prisma.$transaction` падает `EventOutboxMissingContextError`; откат не публикует и не пишет; nested run отклонён.
