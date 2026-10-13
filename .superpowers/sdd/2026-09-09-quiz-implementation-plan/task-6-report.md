# Task 6 report — core app-runtime: диспетчер, replay, кэш проекций, сериализация по комнате

## Что реализовано

Все файлы по брифу, код интерфейсных блоков — verbatim:

- `packages/core/src/app-runtime/app-runtime.tokens.ts` — `APP_RUNTIME_MODULES` (Symbol), тип `RegisteredRuntimeModules`.
- `packages/core/src/app-runtime/app-runtime.errors.ts` — `AppModuleUnavailableError` (MODULE_UNAVAILABLE) и `PublishForbiddenError` (PUBLISH_FORBIDDEN), оба `ContractError` напрямую (wire-код без записи в error-mapping).
- `packages/core/src/app-runtime/room-serializer.ts` — per-room FIFO-цепочка промисов с auto-cleanup записи после settle.
- `packages/core/src/app-runtime/app-projection-cache.ts` — in-memory кэш проекций по roomId с `invalidate` (точка для Task 13).
- `packages/core/src/app-runtime/app-runtime.service.ts` — `AppRuntimeService.dispatch()` → `serializer.run` → `dispatchLocked` с порядком гейтов брифа: room ACTIVE+пин → membership/SPECTATOR → модуль по пину (fail-closed) → clientInitiated → схема payload (до вызова модуля) → проекция (тёплый кэш или replay) → вызов модуля → валидация AppCommit zod-схемой → коммиты через `EventOutbox.run` + `commitAppEvent` в одной транзакции → тёплый fold. Плюс `invalidateProjection(roomId)`.
- `packages/core/src/app-runtime/app-runtime.module.ts` — global dynamic module `AppRuntimeModule.register(modules)` по образцу AppRegistryModule (Task 5).
- `packages/core/src/index.ts` — экспорты tokens/errors/serializer/cache/service/module.

Потреблены сигнатуры Task 1/3/4/5 и ядра как в брифе; расхождений не обнаружено, импровизаций не было.

## Тесты и результаты

### TDD Evidence

**Цикл 1 — RoomSerializer (unit):**
- RED: `pnpm --filter @mymozhem/core test room-serializer` → `TS2307: Cannot find module './room-serializer'` — ожидаемо (модуль не существовал).
- GREEN: та же команда → 4/4 passed: FIFO/50-counter, cross-room non-blocking, rejection не рвёт цепочку, map cleanup до size 0.

**Цикл 2 — диспетчер (int-spec):**
- RED: `pnpm --filter @mymozhem/core test:int app-runtime` → `TS2307: Cannot find module './app-runtime.service'` и `'./app-runtime.errors'` — ожидаемо. (Попутно поймал собственную опечатку в заголовке теста 2 — неэкранированная кавычка; исправлено до GREEN, к реализации отношения не имеет.)
- GREEN: та же команда → 12/12 passed (сценарий 5 брифа разбит на 5a–5d — бриф требует «каждый тест — отдельный it»).

### Полные прогоны перед коммитом

- `pnpm --filter @mymozhem/core test` — 18 suites, 213 tests, all passed.
- `pnpm --filter @mymozhem/core test:int` — 16 suites, 156 tests, all passed (~75 s, testcontainers).
- `pnpm build` — 3/3 successful; `pnpm typecheck` — 5/5 successful.
- `pnpm --filter @mymozhem/core lint` — чисто; `pnpm boundary-check` — 0 violations (487 modules).

Вывод тестов чистый, warnings нет.

## Файлы

Созданы (8): tokens, errors, room-serializer, app-projection-cache, app-runtime.service, app-runtime.module, room-serializer.spec, app-runtime.int-spec — все под `packages/core/src/app-runtime/`. Изменён: `packages/core/src/index.ts` (6 строк экспортов).

## Self-review

- Полнота: все файлы, экспорты, 4 unit-поведения и 9 сценариев брифа (12 `it`) — на месте.
- Оба RED падали по ожидаемой причине (отсутствие модуля), GREEN — без правок реализации после первого прогона.
- Порядок гейтов в `dispatchLocked` — verbatim из брифа.
- Controller rulings учтены: плотность seq в тестах 1 и 8 asserted относительно baseline первого app-события (`appEvents[0].seq`), не абсолютная 1..20/1..40.
- Test 5c: ядро бросает `RoomNotActiveError` с core-кодом `ROOM_NOT_ACTIVE`; wire-код `ROOM_LOG_SEALED` даёт существующий `error-mapping.ts` — в спеке asserted instanceof + core-код, с комментарием про wire.
- Test 8: 20 dispatch × (posted + echoed) = 40 app-событий; asserted плотность диапазона длины 40 от baseline и то, что seq больших payload — не префикс/суффикс (FIFO-сериализация делает их строго чередующимися).

## Замечания

- Тест 8 использует 20 distinct акторов: фикстурный модуль отклоняет повторный `note.posted` одного актора (нужно для тестов 6/7/9), поэтому «все 20 закоммичены» возможно только с разными акторами. Бриф это допускает («смешанный размер payload» — про payload, не про акторов).
- Замечаний к брифу и отклонений от него нет.
