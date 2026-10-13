### Task 10: app-quiz — состояние и редьюсер

**Files:**
- Create: `packages/app-quiz/src/quiz-state.ts`
- Test: `packages/app-quiz/src/quiz-state.spec.ts`

**Interfaces:**
- Consumes: `AppLogEvent` (Task 4).
- Produces (потребляет Task 11):

```typescript
export interface QuizState {
  readonly currentQuestion: number | null;
  readonly accepting: boolean;
  readonly openedAt: string | null; // ISO из recordedAt question.opened — серверное время
  readonly answers: Readonly<Record<string, { optionIndex: number; seq: number }>>; // текущий вопрос, key=actorId
  readonly totals: Readonly<Record<string, number>>;
  readonly finished: boolean;
}
export function initialQuizState(): QuizState;
export function reduceQuiz(state: QuizState, event: AppLogEvent): QuizState;
```

Семантика reduce (чистая, immutable-обновления):
- `question.opened` → `{ currentQuestion: p.questionIndex, accepting: true, openedAt: event.recordedAt, answers: {} }`
- `answer.submitted` → `answers[event.actorId] = { optionIndex: p.optionIndex, seq: event.seq }` (actorId не-null по контракту команды)
- `question.closed` → `accepting: false`
- `question.revealed` → totals += awarded points
- `game.finished` → `finished: true`
- `game.finish`, `answer.accepted` → без изменений состояния
- неизвестный shortName → state без изменений (защитная ветка: реестр гарантирует типы, но редьюсер не падает)

**REQ:** ADR-005 (проекция из лога), REQ-CORE-004.

- [ ] **Step 1: Failing unit tests**

`quiz-state.spec.ts`: начальное состояние; открытие вопроса (answers сбрасываются, openedAt из события); запись ответов двух игроков с seq; повторное открытие другого вопроса сбрасывает ответы; начисление очков через `question.revealed` (суммирование по двум раундам); финиш; неизвестный тип — no-op; иммутабельность (входной state не мутирован — `expect(Object.isFrozen(...))` не требуется, достаточно `expect(state).not.toBe(next)` + глубокое равенство исходного).

- [ ] **Step 2: Run — RED** / **Step 3: Implement** / **Step 4: GREEN**

Run: `pnpm --filter @mymozhem/app-quiz test -- quiz-state`

- [ ] **Step 5: Commit**

```bash
git add packages/app-quiz
git commit -m "feat(app-quiz): состояние и чистый редьюсер проекции (ADR-005)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

