# Task 5 Report: core — seams реестра в composition root

## Что реализовано

- `AppRegistryModule` переписан как global dynamic module со статическим `register(manifests: readonly unknown[]): DynamicModule` — код взят из brief дословно, включая комментарий про seam фазы 2.
- Статические импорты `AppRegistryModule` удалены из `RoomModule` и `RealtimeModule` (и из списков `imports`, и импорт символа) — разрешение `AppRegistryService` теперь через global.
- `apps/server/src/app.module.ts` переключён на `AppRegistryModule.register([])` (пусто до Task 12).
- `packages/core/src/index.ts`: `AppRegistryModule` уже экспортировался (строка 11) — изменений не потребовалось.
- Существующий `app-registry.service.spec.ts`, блок `describe('AppRegistryModule')`: статический `imports: [AppRegistryModule]` заменён на `AppRegistryModule.register([])` — иначе блок падал бы с DI-ошибкой (провайдера APP_MANIFESTS в статическом модуле больше нет, что и есть задуманный fail-closed). Намерение теста (пустой реестр) сохранено, формулировка скорректирована под composition root.

## TDD Evidence

### RED

Команда: `pnpm --filter @mymozhem/core test -- app-registry.module`

Вывод (ожидаемый — register ещё не существует):

```
FAIL src/app-registry/app-registry.module.spec.ts
  ● Test suite failed to run
    error TS2339: Property 'register' does not exist on type 'typeof AppRegistryModule'.
```

Причина ожидаемая: `register` не существовал на классе до реализации.

### GREEN

Команда: `pnpm build && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/server test`

- `pnpm build`: 3 пакета, 3 successful.
- Core: `Test Suites: 17 passed, 17 total / Tests: 209 passed, 209 total` (включая новый `app-registry.module.spec.ts`).
- Server: `Test Suites: 4 passed, 4 total / Tests: 49 passed, 49 total` — `realtime.e2e-spec.ts` (с `.overrideProvider(APP_MANIFESTS)`, без изменений) зелёный.
- Дополнительно `pnpm lint`: 3 successful, чисто.

## Файлы изменены

- `packages/core/src/app-registry/app-registry.module.ts` — register + global
- `packages/core/src/app-registry/app-registry.module.spec.ts` — новый failing-тhen-passing spec
- `packages/core/src/app-registry/app-registry.service.spec.ts` — блок модуля на register([])
- `packages/core/src/room/room.module.ts` — убран статический импорт
- `packages/core/src/realtime/realtime.module.ts` — убран статический импорт
- `apps/server/src/app.module.ts` — `AppRegistryModule.register([])`

## Self-review

- Completeness: register() + global есть; статические импорты удалены из room/realtime; app.module.ts обновлён; grep `grep -rn "AppRegistryModule" packages apps --include="*.ts" | grep -v dist | grep -v spec` показывает только сам модуль и `AppRegistryModule.register([])` в app.module.ts — статических импортов не осталось.
- RED упал по ожидаемой причине: TS2339, register не существует.
- E2E с `overrideProvider(APP_MANIFESTS)` зелёные без изменений (realtime.e2e-spec, transport.e2e-spec — 4 suite'ы, 49 тестов).
- Вывод тестов чистый, без флаки; server e2e прогоняются против testcontainers (изолированный postgres), не против прода.

## Коммит

- `9a161e4` — `refactor(core): APP_MANIFESTS-seam в composition root — AppRegistryModule.register, global (design 2026-09-09 §2)`

## Замечания

- Единственное отклонение от буквы brief: правка `app-registry.service.spec.ts` (существующий блок `describe('AppRegistryModule')` переведён на `register([])`). Brief не упоминал этот блок, но без правки core-сюита падала бы — статический импорт теперь осознанно ломается (fail-closed seam). E2E, названные в brief как «must keep passing unchanged», не тронуты.
