# Task 4 Report — Рефактор EventLogService (appendLocked + deps)

**Status:** DONE
**Branch:** phase-1-event-commit
**Commit:** `f9e3076` — `refactor(core): EventLogService — общий appendLocked + deps (appRegistry/limiter/config), шов commitAppEvent`

## Step 1 — Baseline (до рефактора)

- Docker Desktop: running (`docker info` OK).
- `pnpm --filter @mymozhem/core test` — 10 suites, **117/117 passed**.
- `pnpm --filter @mymozhem/core test:int` — 10 suites, **88/88 passed** (testcontainers, все миграции применены).

## Step 2 — EventLogService

`packages/core/src/realtime/event-log.service.ts` переписан verbatim по brief:
- Конструктор `(appRegistry: AppRegistryService, emitLimiter: EventEmitLimiter, @Inject(APP_CONFIG) config: AppConfig)`.
- `commitCoreEvent` теперь валидирует и делегирует в приватный `appendLocked(tx, roomId, type, payload, actorId, visibility, schemaVersion)` — advisory lock + атомарный `INSERT ... SELECT COALESCE(MAX(seq),0)+1` перенесены без изменений.
- Поведение `commitCoreEvent` не изменилось: те же аргументы, та же валидация, тот же SQL.

## Step 3 — RealtimeModule

`packages/core/src/realtime/realtime.module.ts`: импорты `ConfigModule` + `AppRegistryModule` (оба экспортируют нужные провайдеры — проверено), `EventEmitLimiter` через фабрику от `APP_CONFIG.EVENT_EMIT_RATE_LIMIT_PER_MIN`, экспорт `EventLogService` без изменений. PrismaModule по-прежнему не импортируется (REQ-DEV-008).

## Step 4 — Barrel

В `packages/core/src/index.ts` рядом с `event-log.service` добавлены:
- `export * from './realtime/event-emit-limiter';`
- `export * from './realtime/realtime.errors';` (резолвится — файл из Task 3 на ветке).

## Step 5 — Ручные конструирования (6 файлов)

Все `new EventLogService()` заменены на `new EventLogService(new AppRegistryService(<registry>), new EventEmitLimiter(1000), TEST_CONFIG)`:

| Файл | Мест | Registry |
|---|---|---|
| `packages/core/src/realtime/event-log.int-spec.ts` | :25 (внутри RoomService), :35 (eventLog) | `[validManifests[0]]` оба |
| `packages/core/src/room/room.service.int-spec.ts` | :30, :553 | `[validManifests[0]]`, `[]` |
| `packages/core/src/auth/token.service.int-spec.ts` | :41 | `[]` |
| `packages/core/src/membership/membership.service.int-spec.ts` | :37 | `[]` |
| `apps/server/test/transport.e2e-spec.ts` | :97 | `[]` |

Импорты `EventEmitLimiter` добавлены: `./event-emit-limiter` в realtime-спеке, `../realtime/event-emit-limiter` в остальных core-спеках, из `@mymozhem/core` в e2e.

## Lint note (unused deps)

`pnpm --filter @mymozhem/core lint` — чисто без каких-либо правок: правило no-unused-vars на constructor parameter properties не срабатывает. Временный комментарий НЕ потребовался; параметры оставлены как в brief.

## Step 6 — Verify

- `pnpm --filter @mymozhem/core test` — **117/117 passed** (те же тесты, ассерты не тронуты).
- `pnpm --filter @mymozhem/core test:int` — **88/88 passed**.
- `pnpm --filter @mymozhem/server test` (e2e): первый прогон упал с TS2305 (`EventEmitLimiter` не экспортирован) — apps/server резолвит `@mymozhem/core` из stale dist. После `pnpm build` — **15/15 passed** (2 suites). Не дефект кода, артефакт сборки.
- `pnpm build` — 3/3 успешно; `pnpm lint` — 3/3; `pnpm typecheck` — 5/5.

## Step 7 — Commit

```
git add packages/core/src/realtime packages/core/src/index.ts \
  packages/core/src/room/room.service.int-spec.ts \
  packages/core/src/auth/token.service.int-spec.ts \
  packages/core/src/membership/membership.service.int-spec.ts \
  apps/server/test/transport.e2e-spec.ts
git commit -m "refactor(core): EventLogService — общий appendLocked + deps (appRegistry/limiter/config), шов commitAppEvent"
```
→ `f9e3076`, 8 files changed, 107 insertions(+), 21 deletions(-).

## Границы

- Миграций нет, новых runtime-зависимостей нет, SDK-контракт не тронут.
- Lock-ordering соблюдён: advisory lock остаётся leaf-most, appendLocked не пишет в room."Room".
- Ассерты существующих тестов не редактировались — только конструкции `new EventLogService(...)` и импорты.

## Concerns

Нет. Единственное наблюдение: e2e apps/server зависит от свежести dist ядра — при работе над core перед прогоном e2e нужен `pnpm build` (это уже отражено порядком команд в brief Step 6).
