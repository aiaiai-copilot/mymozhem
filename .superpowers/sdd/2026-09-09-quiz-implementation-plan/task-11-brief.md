### Task 11: app-quiz — handlers команд и фабрика рантайм-модуля

**Files:**
- Create: `packages/app-quiz/src/quiz-handlers.ts`
- Create: `packages/app-quiz/src/quiz-runtime.ts`
- Test: `packages/app-quiz/src/quiz-handlers.spec.ts`
- Modify: `packages/app-quiz/src/index.ts`

**Interfaces:**
- Consumes: Tasks 4, 9, 10.
- Produces (потребляют Task 12–13):

```typescript
// quiz-runtime.ts
export function createQuizRuntime(): AppRuntimeModule<QuizState>;
export function createQuizApp(): { manifest: AppManifest; runtime: AppRuntimeModule<QuizState> };
```

Логика `handlePublish(ctx, shortName, payload)` (payload уже проверен схемой диспетчером — каст через `as` к выведенному типу допустим и локален):

- Общее: `settings = quizSettingsSchema.parse(ctx.settings)` (валидировано при configure/activate — повторный parse здесь защитный и дешёвый).
- `question.opened` (ORGANIZER только — иначе `AppRejection('PUBLISH_FORBIDDEN')`; аналогично `question.closed`, `game.finish`):
  - `ctx.state.finished` → `ROUND_NOT_OPEN` («игра завершена»); `state.accepting` → `ROUND_NOT_OPEN` («прежний вопрос не закрыт»); `questionIndex >= settings.questions.length` → `QUESTION_UNKNOWN`.
  - commits: `[{ shortName: 'question.opened', payload, visibility: 'public', actor: 'publisher' }]`.
- `answer.submitted`:
  - `ctx.actorRole !== 'PARTICIPANT'` → `PUBLISH_FORBIDDEN` (организатор не играет; SPECTATOR отсечён ядром раньше — защитная ветка).
  - `!state.accepting || state.currentQuestion === null` → `ROUND_NOT_OPEN`.
  - `payload.questionIndex !== state.currentQuestion` → `QUESTION_UNKNOWN`.
  - `payload.optionIndex >= settings.questions[state.currentQuestion].options.length` → `OPTION_UNKNOWN`.
  - `state.answers[ctx.actorId] !== undefined` → `ALREADY_ANSWERED`.
  - REQ-RT-013: `minAnswerIntervalMs > 0 && state.openedAt !== null && Date.parse(ctx.now) - Date.parse(state.openedAt) < settings.minAnswerIntervalMs` → `ANSWER_TOO_FAST`.
  - commits: `[answer.submitted (module-private, publisher), answer.accepted { questionIndex, actorId } (public, server)]`.
- `question.closed`:
  - `!state.accepting || payload.questionIndex !== state.currentQuestion` → `ROUND_NOT_OPEN`.
  - Скоринг: правильные ответы (`optionIndex === settings.correctAnswers[qi]`; отсутствующий `correctAnswers[qi]` → правильных нет) ранжируются по `seq`; k-й (0-based) получает `max(base − k·step, 0)`. `totals` — из state + awarded.
  - commits: `[question.closed (public, publisher), question.revealed { questionIndex, awarded, totals, ...(correctAnswers[qi] !== undefined ? { correctIndex: correctAnswers[qi] } : {}) } (public, server)]` — `correctIndex` опущен, когда ответ не сконфигурирован (схема — Task 9, поле optional).
- `game.finish`:
  - `state.finished` → `ROUND_NOT_OPEN`; (открытый вопрос можно не закрывать — закрытие валится в standings как есть; осознанное упрощение MVP).
  - standings: `Object.entries(state.totals)` по убыванию total, place = 1-based с разделением мест при равенстве (плотный ранг: 1,2,2,3).
  - commits: `[game.finish (public, publisher), game.finished { standings } (public, server)]`.

**REQ:** REQ-RT-013 (анти-бот), REQ-RT-009 (actorId из ctx), REQ-ID-011 (ролевые гейты), REQ-CTR-009 (visibility явно, в пределах ceiling).

- [ ] **Step 1: Failing unit tests** — `quiz-handlers.spec.ts`, фабрика ctx:

```typescript
const ctx = (over: Partial<AppHostContext<QuizState>>): AppHostContext<QuizState> => ({
  roomId: 'r', actorId: ORG, actorRole: 'ORGANIZER', settings: SETTINGS,
  state: initialQuizState(), now: '2026-09-09T12:00:00.000Z', ...over,
});
```

Тесты (таблица): каждая ветка отказа выше (код ошибки); счастливые пути (точный состав commits включая actor/visibility); анти-бот границы (`interval-1` → отказ, `interval` → принят, `0` → контроль выключен); скоринг (3 правильных по seq → 1000/900/800 при base 1000 step 100; неправильный — 0 и сгорает: повторный `answer.submitted` → ALREADY_ANSWERED); dense-rank standings; двойной game.finish → отказ; открытие второго вопроса при открытом первом → отказ.

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/app-quiz test -- quiz-handlers`
Expected: FAIL.

- [ ] **Step 3: Implement** handlers + runtime-фабрика (`reduce: reduceQuiz`, `initialState: initialQuizState`, `manifest: buildQuizManifest()`).

- [ ] **Step 4: Run — GREEN + boundary**

Run: `pnpm --filter @mymozhem/app-quiz test && pnpm boundary-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app-quiz
git commit -m "feat(app-quiz): handlers команд квиза — ролевые гейты, анти-бот REQ-RT-013, скоростная шкала, standings

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

