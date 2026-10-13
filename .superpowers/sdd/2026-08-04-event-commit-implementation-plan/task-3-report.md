# Task 3 Report: Realtime-ошибки + event-методы AppRegistryService

**Status:** DONE
**Commit:** `ec7f15e` — `feat(core): realtime errors + event read-path в AppRegistryService (REQ-CTR-008/009)`
**Branch:** phase-1-event-commit

## Что сделано

1. **Создан** `packages/core/src/realtime/realtime.errors.ts` — verbatim по brief Step 3a:
   `REALTIME_ERROR_CODES` (7 кодов), тип `RealtimeErrorCode`, базовый `RealtimeError` и 7
   подклассов: `RoomNotActiveError`, `EventEmitRateLimitedError`, `EventPayloadTooLargeError`,
   `EventTypeUnknownError`, `EventPayloadInvalidError`, `EventVisibilityExceededError`,
   `ActorNotMemberError`. Потребляет Task 5.

2. **Изменён** `packages/core/src/app-registry/app-registry.service.ts` — 3 публичных метода
   после `validateSettings`, verbatim по brief Step 3b:
   - `getEventDefinition(appId, manifestVersion, name)` — schema + visibility потолок из
     пиннутого манифеста, `undefined` для неизвестного типа/манифеста.
   - `eventValidatorFor(...)` — кэшированные ajv-валидаторы app-событий с ключом
     `event:appId@version:name` (не пересекается с ключом настроек `appId@version`).
   - `describeEventErrors(validate)` — `ajv.errorsText(validate.errors)`.

   Импорты не потребовались: `JsonSchemaObject` и `ValidateFunction` уже были импортированы
   в файле (подтверждено контекстом задания).

3. **Расширена** `packages/core/src/app-registry/app-registry.service.spec.ts` — describe
   `event-commit read-path (REQ-CTR-008/009)` с 3 тестами verbatim по brief Step 1.

## TDD-протокол

- **Red:** `pnpm --filter @mymozhem/core test -t "event-commit read-path"` — FAIL с
  TS2339 (`getEventDefinition`/`eventValidatorFor`/`describeEventErrors` не существуют),
  как ожидал brief Step 2.
- **Green:** тот же фильтр — **3 passed, 114 skipped** (фильтр матчит ровно 3 теста).
- **Full suite:** `pnpm --filter @mymozhem/core test` — **117/117 passed, 10/10 suites**.
- **Typecheck:** `pnpm typecheck` — 5/5 задач успешно.

## Отклонения от brief

Нет. Код и тесты вставлены verbatim; форма jest-фильтра без `--`; коммит-сообщение точно по
Step 5. Затронуты только 3 разрешённых файла; новых зависимостей и изменений SDK нет.

## Concerns

Нет.
