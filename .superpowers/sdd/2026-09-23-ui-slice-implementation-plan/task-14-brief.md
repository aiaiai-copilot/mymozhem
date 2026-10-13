### Task 14: Консоль — ведение квиза

**Files:**
- Create: `apps/web/src/pages/host/console-page.tsx`, `apps/web/src/pages/host/quiz-controls.tsx`
- Test: `apps/web/src/pages/host/quiz-controls.spec.ts` (селектор next-question/answers-count)

**Interfaces:**
- Consumes: Tasks 7–11, 13. `projectQuiz`, `deriveRoomStatus`, publish-команды `quiz.question.opened/closed`, `quiz.game.finish` (clientInitiated; reveal/finished коммитит модуль — кнопок reveal нет).
- Produces: `answersCount(events, questionIndex): number` (distinct actorId среди `quiz.answer.accepted` текущего вопроса).

- [ ] **Step 1: Failing test answersCount / nextQuestionIndex**

- [ ] **Step 2: Implement** — console-page: код комнаты крупно + копируемые ссылки `/play/<code>` и `/screen/<code>` (navigator.clipboard); ConnectionBanner; quiz-controls по проекции: «Открыть вопрос N» (`N = quiz.currentQuestion === null ? 0 : quiz.currentQuestion + 1`; disabled, пока `accepting`); «Закрыть вопрос» (пока accepting); счётчик ответов `answersCount`; после reveal — `<Standings>`; «Завершить квиз» → publish `quiz.game.finish` → `<Standings>` финальный. Ошибки publish → текст кода (`ApiError.code`).

- [ ] **Step 3: Run green**, typecheck/build

- [ ] **Step 4: Commit** — `feat(web): консоль ведущего — ведение квиза (open/close/finish, счётчик, табло)`

