# Task 6 Report: Псевдонимы гостей (ADR-012 §3, батч B)

**Status:** DONE
**Commit:** b9cf868 — `feat(core): серверные псевдонимы гостей (ADR-012 §3) — displayName необязателен, генератор «Лиса-42» с retry по ростеру, join-ответ несёт фактическое имя`

## Что реализовано

1. **`packages/core/src/membership/pseudonym.ts`** (новый) — `generatePseudonym(taken, rnd = crypto.randomInt)`: словарь из 50 существительных (verbatim из брифа), 5 попыток «Слово-NN» (10–99) → 5 попыток «Слово-NNN» (100–999) → детерминированный скан suffix от 10 (терминирует всегда). `Math.random` не используется; детерминизм в тестах — инжекция `rnd`.
2. **`packages/core/src/membership/membership.service.ts`** — сигнатура `join`: `displayName?: string`; ранняя zod-валидация только заданного имени (`providedName = params.displayName === undefined ? undefined : displayNameSchema.parse(...)`); генерация псевдонима ВНУТРИ `$transaction` (чтение ростера `takenDisplayNames` + `createGuest` в одной tx); `JoinResult += displayName: string`.
3. **`packages/core/src/transport/join.controller.ts`** — ответ типа `JoinResponse`, возвращает `displayName` из результата join. Санкционированное красное `TS2322` (ruling T2.1) снято — typecheck дерева зелёный.
4. **e2e-потребители join** — строгие парсы ответа join переведены с `tokenResponseSchema` (strictObject, падали бы на новом поле) на `joinResponseSchema`: transport (2 места), quiz, quiz-points, lottery, realtime (2 места). Refresh-парсы (tokenResponseSchema) не тронуты — refresh displayName не несёт.
5. **transport.e2e-spec.ts** — тест «невалидное тело → 400» переписан на по-настоящему невалидное тело (`displayName: ''`), т.к. отсутствие имени теперь легально; добавлен e2e «join без displayName → 201, сервер назначает псевдоним» (Review Focus 2 на HTTP-уровне, поверх service-level пина шага 4).

## TDD evidence

**RED 1 (unit):** `pnpm --filter @mymozhem/core test -- pseudonym` →
`FAIL src/membership/pseudonym.spec.ts — TS2307: Cannot find module './pseudonym'` (модуль не существовал).

**GREEN 1:** после создания `pseudonym.ts` → `Tests: 3 passed, 3 total`.

**RED 2 (int):** `pnpm --filter @mymozhem/core test:int -- membership.service` →
suite не компилируется: `TS2322` на `displayName: undefined` (параметр был обязательным) + `TS2339: Property 'displayName' does not exist on type 'JoinResult'`.

**GREEN 2:** после реализации join → `Tests: 42 passed, 42 total`, включая:
- `✓ join без displayName: сервер назначает псевдоним «Слово-NN» (ADR-012 §3, Review Focus 2)`
- `✓ два безымянных гостя получают РАЗНЫЕ псевдонимы в одной комнате`
- `✓ заданное имя проходит без изменений (свободный ввод сохранён)`

## Ruling B-pre.2 (применён)

Тест 3 брифа НЕ хардкодит «Лиса»: слово выводится пробным вызовом `generatePseudonym(new Set(), sequence([0, 0]))` (→ `Барсук-10`, словарь начинается с «Барсук»), exhaustion-сет из 90 имён строится для этого слова, ассерт — `^${word}-(1\d\d|\d{4})$`. Семантика пина (расширение диапазона при исчерпании 10–99) сохранена.

## Файлы

- `packages/core/src/membership/pseudonym.ts` (new)
- `packages/core/src/membership/pseudonym.spec.ts` (new)
- `packages/core/src/membership/membership.service.ts`
- `packages/core/src/membership/membership.service.int-spec.ts`
- `packages/core/src/transport/join.controller.ts`
- `apps/server/test/transport.e2e-spec.ts`, `quiz.e2e-spec.ts`, `quiz-points.e2e-spec.ts`, `lottery.e2e-spec.ts`, `realtime.e2e-spec.ts`

## Гейты (финальное состояние, всё зелёное)

| Гейт | Результат |
|---|---|
| `pnpm build` | 6/6 successful |
| `pnpm boundary-check` | no dependency violations (726 modules) |
| `pnpm guardrails` | all guardrails alive |
| `pnpm lint` | 6/6 (после фикса `_bound` unused — см. self-review) |
| `pnpm typecheck` | 10/10 successful |
| `pnpm test` | 10/10 successful (включая server unit) |
| `pnpm --filter @mymozhem/core test:int` | 23 suites, 213 tests passed |
| `pnpm --filter @mymozhem/server test` | 9 suites, 63 passed + 1 skipped (skip пре-существующий: `it.skip` в lottery.e2e-spec.ts:346) |

## Self-review findings

1. **Lint-фикс отступления от брифа:** хелпер `sequence` в `pseudonym.spec.ts` — параметр `(_bound: number)` заменён на безпараметрическую лямбду (`() => values[i++ % values.length]`); eslint репозитория не игнорирует underscore-параметры (`@typescript-eslint/no-unused-vars`). На тип совместимость не влияет (меньше параметров — легально для `RandomInt`).
2. `takenDisplayNames` не фильтрует `room.deletedAt` — сознательно: вызывается только из join-tx, где комната уже проверена живой; лишний join-фильтр ничего не дал бы.
3. Заданное гостем имя по-прежнему НЕ проверяется на уникальность в ростере (свободный ввод, дубли легальны) — status quo сохранён, уникальность касается только генерируемых псевдонимов.
4. `pseudonym.ts` не экспортируется из barrel `core/src/index.ts` — внутренность membership-модуля; бриф экспорт не требовал.

## Concerns

Нет. Батч B закрыт: всё дерево монорепы зелёное.
