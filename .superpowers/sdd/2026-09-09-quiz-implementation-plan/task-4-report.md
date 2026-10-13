# Task 4 Report: SDK — рантайм-контракт app-модуля

## Что реализовано

Пять файлов рантайм-контракта в `packages/sdk/src/app-runtime/` (код — verbatim из блока Interfaces брифа, с импортами и поясняющими комментариями в стиле пакета):

- `app-commit.ts` — `appCommitActorSchema` (`publisher`/`server`), `appCommitSchema` (strictObject: shortName/payload/visibility/actor), тип `AppCommit`.
- `app-log-event.ts` — интерфейс `AppLogEvent` (recordedAt — ISO-строка, REQ-CTR-002).
- `app-host-context.ts` — интерфейс `AppHostContext<S>` (now — ISO-строка).
- `app-rejection.ts` — класс `AppRejection extends ContractError` с кодом из `ContractErrorCode`.
- `app-runtime-module.ts` — интерфейс `AppRuntimeModule<S>` (appId, manifestVersion, manifest, initialState/reduce/handlePublish).
- `app-commit.fixtures.ts` — пары valid/invalid по образцу существующих fixtures.
- `app-commit.contract.spec.ts` — контрактный тест.
- `index.ts` — экспорты всех пяти файлов + fixtures.

## Тесты и результаты

- Контрактный тест `appCommit contract (REQ-CTR-002/003)`: валидные фикстуры проходят `appCommitSchema`; невалидные отклоняются — лишний ключ (strictObject), shortName `Quiz.x` (uppercase), неизвестная visibility `secret`, actor `client` вне enum, отсутствие actor, не-объект. Плюс явные проверки: actor enum ровно `publisher | server`; uppercase-shortName не проходит.
- 12 тестов в новом spec — все зелёные.

## TDD Evidence

**RED** — `pnpm --filter @mymozhem/sdk test -- app-commit`:

```
FAIL src/app-runtime/app-commit.contract.spec.ts
  ● Test suite failed to run
    error TS2307: Cannot find module './app-commit' or its corresponding type declarations.
Test Suites: 1 failed, 1 total
```

Падение ожидаемое: модуль `./app-commit` ещё не существовал.

**GREEN** — `pnpm --filter @mymozhem/sdk test && pnpm --filter @mymozhem/sdk typecheck`:

```
Test Suites: 23 passed, 23 total
Tests:       280 passed, 280 total
$ tsc -p tsconfig.json --noEmit   (без ошибок)
```

Также `pnpm --filter @mymozhem/sdk lint` — чисто.

## Files changed

- `packages/sdk/src/app-runtime/app-commit.ts` (new)
- `packages/sdk/src/app-runtime/app-commit.fixtures.ts` (new)
- `packages/sdk/src/app-runtime/app-commit.contract.spec.ts` (new)
- `packages/sdk/src/app-runtime/app-log-event.ts` (new)
- `packages/sdk/src/app-runtime/app-host-context.ts` (new)
- `packages/sdk/src/app-runtime/app-rejection.ts` (new)
- `packages/sdk/src/app-runtime/app-runtime-module.ts` (new)
- `packages/sdk/src/index.ts` (modified — 6 export-строк)

Commit: `4f994ff feat(sdk): рантайм-контракт app-модуля — AppRuntimeModule/AppCommit/AppHostContext/AppRejection (REQ-CTR-002/003)`

## Self-review findings

- Все пять файлов + fixtures + spec + экспорты в index.ts на месте (git show --stat: 8 файлов, +116).
- RED упал ровно по ожидаемой причине (TS2307, модуль не найден).
- Тесты проверяют поведение: приём валидных фикстур и отказ по каждому невалидному случаю из брифа (extra key, `Quiz.x`, unknown visibility, actor вне enum).
- Одна поправка в ходе работы: изначально в тест «namespace lookalike» входил `core.round.opened`, но это валидный dotted shortName по `shortEventNameSchema` (namespace добавляет ядро при композиции, подделка структурно невозможна) — убран, тест ограничен uppercase-случаями.
- Вывод тестов чистый, без warnings.

## Issues / concerns

Нет. Контракт соответствует брифу verbatim; Task 6 и 9–11 могут потреблять типы.
