# Task 11 — отчёт: handlers команд и фабрика рантайм-модуля

**Статус:** DONE
**Commit:** `9750944f1836ea8476d8a1c336cbce82ae1704b1` — feat(app-quiz): handlers команд квиза — ролевые гейты, анти-бот REQ-RT-013, скоростная шкала, standings

## Что реализовано

- `packages/app-quiz/src/quiz-handlers.ts` — `handleQuizPublish(ctx, shortName, payload): AppCommit[]`:
  - Общее: `quizSettingsSchema.parse(ctx.settings)` (защитный перепарс); payload не перевалидируется, локальный `as`-каст к `z.infer` типу схемы ветки.
  - `question.opened` / `question.closed` / `game.finish` — гейт `ORGANIZER`, иначе `PUBLISH_FORBIDDEN`.
  - `question.opened`: `finished` → `ROUND_NOT_OPEN`; `accepting` → `ROUND_NOT_OPEN`; `questionIndex >= questions.length` → `QUESTION_UNKNOWN`; happy path — один commit `public/publisher`.
  - `answer.submitted`: не-`PARTICIPANT` → `PUBLISH_FORBIDDEN`; нет открытого вопроса → `ROUND_NOT_OPEN`; чужой `questionIndex` → `QUESTION_UNKNOWN`; `optionIndex` вне диапазона → `OPTION_UNKNOWN`; повтор → `ALREADY_ANSWERED`; REQ-RT-013 — `minAnswerIntervalMs > 0 && openedAt !== null && now - openedAt < interval` → `ANSWER_TOO_FAST`. Commits: `answer.submitted` (`module-private/publisher`) + `answer.accepted {questionIndex, actorId: ctx.actorId}` (`public/server`) — actorId только из ctx (REQ-RT-009).
  - `question.closed`: не открыт / чужой индекс → `ROUND_NOT_OPEN`; скоринг — правильные (`optionIndex === correctAnswers[qi]`, отсутствующий `correctAnswers[qi]` → правильных нет) по возрастанию `seq`, k-й (0-based) получает `max(base − k·step, 0)`; totals = state.totals + awarded. Commits: `question.closed` (`public/publisher`) + `question.revealed {questionIndex, awarded, totals, correctIndex?}` (`public/server`) — `correctIndex` опущен при несконфигурированном ответе.
  - `game.finish`: `finished` → `ROUND_NOT_OPEN`; standings — по убыванию total, плотный ранг (1,2,2,3). Commits: `game.finish` (`public/publisher`) + `game.finished {standings}` (`public/server`).
  - Неизвестный shortName → `EVENT_UNKNOWN_TYPE` (защитная ветка, недостижима при корректном диспетчере).
- `packages/app-quiz/src/quiz-runtime.ts` — `createQuizRuntime(): AppRuntimeModule<QuizState>` (appId/manifestVersion из констант манифеста, `manifest: buildQuizManifest()`, `initialState: initialQuizState`, `reduce: reduceQuiz`, `handlePublish: handleQuizPublish`) и `createQuizApp(): { manifest, runtime }`.
- `packages/app-quiz/src/index.ts` — barrel дополнен `quiz-handlers` и `quiz-runtime`.
- `packages/app-quiz/src/quiz-handlers.spec.ts` — 29 новых тестов.

## RED → GREEN

- RED: `pnpm --filter @mymozhem/app-quiz test -- quiz-handlers` → FAIL, `TS2307: Cannot find module './quiz-handlers' / './quiz-runtime'` (suite не собирается, реализации нет).
- GREEN: `pnpm --filter @mymozhem/app-quiz test` → `Test Suites: 3 passed, 3 total; Tests: 83 passed, 83 total`.
- `pnpm boundary-check` → `no dependency violations found (508 modules, 1472 dependencies)`.
- `pnpm --filter @mymozhem/app-quiz typecheck` → чисто; `lint` → чисто.

Покрытие тестами: все ветки отказов (код точно); happy paths с точным составом commits (shortName/payload/visibility/actor); анти-бот границы (interval−1 → отказ, ровно interval → принят, `0` → контроль выключен, `openedAt: null` → принят); скоринг 1000/900 при base 1000 step 100 по seq, неправильный ответ сгорает (повторный → `ALREADY_ANSWERED`); слияние awarded в существующие totals; `correctIndex` опущен при пустом `correctAnswers`; dense-rank (1,2,2 при totals 100/50/50); двойной `game.finish` → отказ; открытие второго вопроса при открытом первом → отказ; фабрика рантайма (wiring + dispatch через `runtime.handlePublish`).

## Файлы

- Созданы: `packages/app-quiz/src/quiz-handlers.ts`, `packages/app-quiz/src/quiz-runtime.ts`, `packages/app-quiz/src/quiz-handlers.spec.ts`
- Изменён: `packages/app-quiz/src/index.ts`

## Отклонения от брифа и допущения

1. **Порядок `totals` и `standings`** — бриф не задаёт порядок элементов в массивах. Выбран детерминированный: по убыванию `total`, при равенстве — по `actorId` (лексикографически). Это делает payload стабильным для клиентов и тестов; редьюсер поле `totals` игнорирует, так что на проекцию не влияет.
2. **`awarded` включает все правильные ответы, включая клампнутые в 0** (`max(base − k·step, 0)`) — буквальное прочтение брифа («k-й получает max(...)»); тест этот случай не фиксирует (в фикстуре очки > 0).
3. **Защитная ветка unknown shortName → `EVENT_UNKNOWN_TYPE`** — в брифе не описана, но switch должен быть исчерпывающим; код из `CONTRACT_ERROR_CODES`.
4. **Защита `settings.questions[state.currentQuestion] === undefined` → `OPTION_UNKNOWN`** в `answer.submitted` — дешёвая страховка от рассинхрона state/settings (state из лога, settings текущие); при согласованных данных недостижима.

## Self-review

- Импорты только `@mymozhem/sdk` + zod + локальные файлы — boundary-check зелёный (REQ-DEV-001, граница leaf-пакета).
- `actorId` в исходящих payload'ах только из `ctx.actorId` (REQ-RT-009); роль только из `ctx.actorRole` (REQ-ID-011).
- Все коды отказов — из `CONTRACT_ERROR_CODES`; `AppRejection` пробрасывается как есть (app-runtime.service.ts:117-119).
- Чистые функции, без глобального мутабельного состояния (REQ-CORE-004); visibility каждого commit'а явная и не сильнее манифестного ceiling (REQ-CTR-009): `answer.submitted` — `module-private`, как в манифесте.
- Имена событий dotted-lowercase согласно ruling батча 3.

## Замечания

Нет блокеров. Потребители (Task 12–13) получают `createQuizRuntime()` / `createQuizApp()` согласно интерфейсу брифа.

---

## Fix-отчёт (ревью, Important finding)

**Finding (Important):** `quiz-handlers.ts` — dense-rank был реализован как competition ranking: `place = index + 1` при смене total давал `1,2,2,4` для totals {100,50,50,30}, а бриф фиксирует плотный ранг `1,2,2,3`. Прежний тест (100/50/50 → 1,2,2) не различал оба варианта, поэтому проходил.

**Fix:** в `finishGame` (`packages/app-quiz/src/quiz-handlers.ts`) место вычисляется инкрементом на каждое новое отличное значение total (`place += 1` при смене), а не `index + 1`. Равные total делят место; следующее отличное значение получает непосредственно следующее место → `1,2,2,3`. Комментарий в коде явно фиксирует отличие от competition ranking.

**Покрывающий тест:** `packages/app-quiz/src/quiz-handlers.spec.ts` — тест `computes dense-rank standings (1,2,2,3)` усилен до различающего случая: totals {P1:100, P2:50, P3:50, P4:30} → места `1,2,2,3` (competition ranking дал бы `1,2,2,4`).

**RED → GREEN:**
- RED: `pnpm --filter @mymozhem/app-quiz test -- quiz-handlers` → `1 failed, 30 passed` — `game.finish › computes dense-rank standings (1,2,2,3)` падал до исправления.
- GREEN: `pnpm --filter @mymozhem/app-quiz test` → `Test Suites: 3 passed, Tests: 83 passed, 83 total`. `typecheck`, `lint`, `pnpm boundary-check` — чисто.

**Commit фикса:** `4d331816d6008206a74782b6074a8877de21a9ea` — fix(app-quiz): standings — плотный ранг вместо competition ranking (1,2,2,3)
