# Task 10 report: app-quiz — состояние и редьюсер

**Status:** DONE
**Commit:** `27c63f3` — `feat(app-quiz): состояние и чистый редьюсер проекции (ADR-005)`
**Branch/worktree:** `quiz` @ `.worktrees/quiz` (не запушено — per instructions)

## Что реализовано

- `packages/app-quiz/src/quiz-state.ts`:
  - `QuizState` — readonly-интерфейс в точности по брифу (`currentQuestion`, `accepting`, `openedAt`, `answers`, `totals`, `finished`).
  - `initialQuizState()` — пустое состояние.
  - `reduceQuiz(state, event)` — чистый редьюсер, switch по `event.shortName`:
    - `question.opened` → `currentQuestion = p.questionIndex`, `accepting: true`, `openedAt = event.recordedAt`, `answers: {}`;
    - `answer.submitted` → `answers[event.actorId] = { optionIndex: p.optionIndex, seq: event.seq }`; защитная ветка `actorId === null` → no-op (тип `AppLogEvent.actorId` — `string | null`, по контракту команды не-null);
    - `question.closed` → `accepting: false`;
    - `question.revealed` → `totals` перестраивается из `awarded` (предыдущие суммы + points по actorId); **поле `totals` payload'а игнорируется** — проекция derived, не trusted (context note 3);
    - `game.finished` → `finished: true`;
    - default (`game.finish`, `answer.accepted`, неизвестные) → возврат state без изменений (та же ссылка — no-op).
  - Payload'ы не валидируются в рантайме (реестр провалидировал до коммита в лог); типизация через `z.infer` схем из `quiz-events.ts` + узкий локальный `as` на ветку (context note 2).
- `packages/app-quiz/src/index.ts`: добавлен `export * from './quiz-state'` (Task 11 потребляет `QuizState`/`reduceQuiz`).
- `packages/app-quiz/src/quiz-state.spec.ts`: 11 тестов — начальное состояние; открытие вопроса (answers сброшены, `openedAt` из `recordedAt`); ответы двух игроков с seq; повторное открытие сбрасывает ответы; `question.closed` не трогает answers; начисление очков по двум раундам с «врущим» `totals` в payload (проверка derived-перестройки); `game.finished`; `game.finish`/`answer.accepted` — no-op (та же ссылка); неизвестный тип — no-op; иммутабельность (`next !== state`, снапшот исходного не изменён, новые ссылки `answers`/`totals`).

## RED → GREEN evidence

RED (до реализации, suite не компилируется — модуля нет):

```
$ pnpm --filter @mymozhem/app-quiz test -- quiz-state
FAIL src/quiz-state.spec.ts
  ● Test suite failed to run
    src/quiz-state.spec.ts:2:62 - error TS2307: Cannot find module './quiz-state' ...
Test Suites: 1 failed, 1 total
```

GREEN (после реализации):

```
$ pnpm --filter @mymozhem/app-quiz test -- quiz-state
PASS src/quiz-state.spec.ts
Tests: 11 passed, 11 total
```

Гейты (полный прогон пакета + монорепо boundary):

```
$ pnpm --filter @mymozhem/app-quiz test      → Test Suites: 2 passed, Tests: 52 passed
$ pnpm --filter @mymozhem/app-quiz typecheck → clean (tsc --noEmit)
$ pnpm --filter @mymozhem/app-quiz lint      → clean (eslint src)
$ pnpm boundary-check                        → no dependency violations found (505 modules, 1455 dependencies)
```

## Files changed (commit 27c63f3, 3 files, +230)

- `packages/app-quiz/src/quiz-state.ts` (new)
- `packages/app-quiz/src/quiz-state.spec.ts` (new)
- `packages/app-quiz/src/index.ts` (+1 строка экспорта)

## Self-review

- Границы: импорты только `@mymozhem/sdk` (`type AppLogEvent`), `zod` (type-only), локальные `quiz-events` — `@mymozhem/core` не импортируется; boundary-check зелёный.
- REQ: ADR-005 (проекция из лога, чистый редьюсер) — покрыто; REQ-CORE-004 — нет глобального мутабельного состояния, редьюсер чистый.
- Семантика `question.revealed` проверена тестом с намеренно неверным `totals` в payload — редьюсер перестраивает сумму из `awarded`.
- No-op ветки возвращают ту же ссылку на state (pin'ится тестом `toBe`) — дёшево и явно.
- Отклонений от брифа нет. Единственное дополнение сверх списка тестов брифа — явные тесты no-op для `game.finish`/`answer.accepted` и `question.closed` (семантика перечислена в брифе как binding, тесты её фиксируют).
