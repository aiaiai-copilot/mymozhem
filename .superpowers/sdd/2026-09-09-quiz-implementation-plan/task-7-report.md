# Task 7 report: core — gateway на диспетчер

## Что реализовано

`RealtimeGateway.handlePublish` переключён с прямого коммита в лог (`outbox.run` + `eventLog.commitAppEvent`) на диспетчер `AppRuntimeService.dispatch({roomId, actorId, appId, shortName, payload})` — подход «командный хост» (design 2026-09-09 §2):

- Конструктор gateway: `- EventLogService, - EventOutbox, + AppRuntimeService` (разрешение через global `AppRuntimeModule` из Task 6, статический импорт в `RealtimeModule` не потребовался — провайдеры модуля без изменений, как в брифе).
- `effectiveVisibility` удалён вместе с неиспользуемыми импортами (`PublishRequest`, `Visibility`, `EventLogService`, `EventOutbox`). `AppRegistryService` оставлен — нужен в `handleSubscribe` для manifest snapshot. Комментарий в коде фиксирует: `request.visibility` для app-типов более не читается, набор и видимость коммитов определяет модуль (`AppCommit`), потолок принуждается commit'ом (REQ-CTR-009).
- Отказы диспетчера маппятся существующим `wireCodeOf` без изменений: `AppRejection`/`AppModuleUnavailableError`/`PublishForbiddenError` — подклассы `ContractError` → `err.code`; `RoomNotActiveError` — через `contractCodeFor` → `ROOM_LOG_SEALED`.
- `apps/server/src/app.module.ts`: `AppRuntimeModule.register([])` (пусто до Task 12).
- `apps/server/test/realtime.e2e-spec.ts`: passthrough-модуль `TEST_APP_MODULE` (сниппет брифа verbatim: коммитит вход как есть, visibility — декларированный потолок типа, actor publisher) + `overrideProvider(APP_RUNTIME_MODULES).useValue([TEST_APP_MODULE])` рядом с существующим override `APP_MANIFESTS`.

## Отклонение от списка файлов брифа (necessary fix)

`packages/core/src/app-runtime/app-runtime.module.ts` — добавлены `imports: [PrismaModule, MembershipModule, RealtimeModule]` в dynamic module `register()`. Бриф файл не перечислял, но без этого Nest DI не разрешает зависимости `AppRuntimeService` (PrismaService, MembershipService, EventLogService, EventOutbox) — bootstrap любого приложения с `AppRuntimeModule.register` падает. В Task 6 это не вскрылось: `app-runtime.int-spec.ts` конструирует сервис вручную, без Nest-контейнера. `AppRegistryService` приходит из global `AppRegistryModule` (тот же шов, что APP_MANIFESTS в Task 5); циклической зависимости нет — `RealtimeModule` не импортирует `AppRuntimeModule`, gateway разрешает `AppRuntimeService` через global-провайдер. Boundary-check (487 модулей) нарушений не нашёл.

## TDD Evidence

### RED

- Команда: `pnpm --filter @mymozhem/core test -- realtime.gateway`
- Результат: `FAIL src/realtime/realtime.gateway.spec.ts` — `TS2554: Expected 11 arguments, but got 10` на `new RealtimeGateway(...)` (спек конструирует gateway по новой сигнатуре с `appRuntime`, реализация ещё со старой — `eventLog`/`outbox`). Падение по ожидаемой причине: новый путь (dispatch) в реализации отсутствует.

### GREEN

- `pnpm --filter @mymozhem/core test -- realtime.gateway` → 19/19 passed (включая новые: dispatch с `{roomId из подписки, actorId из claims, appId, shortName, payload}`; core-неймспейс — `EVENT_UNKNOWN_TYPE` без вызова dispatch; `AppRejection` → ack `{code: 'PUBLISH_FORBIDDEN'}`; `RoomNotActiveError` → `ROOM_LOG_SEALED`).
- `pnpm build` → 3/3 successful.
- `pnpm --filter @mymozhem/core test` → 18 suites, 213/213 passed.
- `pnpm --filter @mymozhem/server test` → 4 suites, 49/49 passed (все realtime e2e зелёные на новом пути через passthrough-модуль; логи `OAUTH_NOT_CONFIGURED` в oauth.e2e — штатные error-path логи).
- Гейты: `pnpm boundary-check` — no violations; `pnpm lint` — 3/3; `pnpm typecheck` — 5/5; `pnpm guardrails` — all alive.

## Files changed

- `packages/core/src/realtime/realtime.gateway.ts` — handlePublish → dispatch; конструктор; удалён `effectiveVisibility`.
- `packages/core/src/realtime/realtime.gateway.spec.ts` — моки и describe `handlePublish` под новый путь.
- `packages/core/src/app-runtime/app-runtime.module.ts` — imports для DI (см. отклонение выше).
- `apps/server/src/app.module.ts` — `AppRuntimeModule.register([])`.
- `apps/server/test/realtime.e2e-spec.ts` — `TEST_APP_MODULE` + override `APP_RUNTIME_MODULES`.

## Self-review findings

- Diff перечитан: 5 файлов, +80/−82. Семантика publish-отказов сохранена: e2e `publish в запечатанную комнату → ROOM_LOG_SEALED` проходит через гейт 1 диспетчера (`RoomNotActiveError` → `contractCodeFor`), spoofed-actorId e2e — через `actor: 'publisher'` passthrough-модуля (actorId конверта — из токена, REQ-RT-009).
- Тест «defaults visibility to the type ceiling» удалён осознанно: умолчание visibility переехало из gateway в модуль (фаза-1 семантика теперь явно в passthrough `TEST_APP_MODULE`), проверять в gateway unit-spec больше нечего.
- Имена `AppRuntimeModule` (тип SDK) и `AppRuntimeModule` (класс core) не коллидируют: в e2e тип импортирован из `@mymozhem/sdk`, класс из `@mymozhem/core` в импорт-листе e2e отсутствует.

## Issues / concerns

- Леджер Task 6: `AppRuntimeModule.register()` создавался без `imports` — DI-разрешение `AppRuntimeService` до этой задачи ничем не проверялось (int-spec обходит контейнер). Исправлено здесь; если план ведёт леджер отклонений, стоит записать «Task 6 → Task 7: register() получил imports [PrismaModule, MembershipModule, RealtimeModule]».
