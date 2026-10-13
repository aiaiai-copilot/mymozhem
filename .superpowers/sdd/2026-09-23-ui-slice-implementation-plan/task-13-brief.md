### Task 13: Лендинг, OAuth-гейт, создание комнаты, setup (редактор квиза / настройки лотереи)

**Files:**
- Create: `apps/web/src/pages/landing.tsx`, `apps/web/src/pages/host/host-gate.tsx`, `apps/web/src/pages/host/setup-page.tsx`, `apps/web/src/pages/host/quiz-editor.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/pages/host/quiz-editor.spec.ts` (сборка settings из формы)

**Interfaces:**
- Consumes: Tasks 7, 10; `QUIZ_APP_ID`, `QUIZ_MANIFEST_VERSION`, `quizSettingsSchema` (`@mymozhem/app-quiz`); `LOTTERY_APP_ID` (`@mymozhem/app-lottery`); `configureRoom`, `activateRoom` (Task 7).
- Produces: `buildQuizSettings(form: QuizFormState): unknown` — чистая функция формы → settings (тестируема без DOM); потребитель Task 14 — `SessionStore.loadHostRoomId`.

- [ ] **Step 1: Failing test buildQuizSettings**

```ts
it('maps form rows to quiz settings (correctAnswers из отмеченных радио)')
it('reject пустого текста/варианта (quizSettingsSchema.safeParse fail)')
```

- [ ] **Step 2: Implement**

landing.tsx: две кнопки — «Я организатор» → `<a href={'/auth/google?redirect=' + encodeURIComponent('/host')}>`; «У меня есть код» → ввод → navigate `/play/${code}`.

host-gate.tsx: `useEffect` → `refreshSession` (cookie same-origin; `auth:false`) → ok: `setAccessToken`, claims.kind === 'REGISTERED' иначе navigate('/') → `SessionStore.loadHostRoomId()` → есть: navigate('/host/console'); нет: navigate('/host/new'). Ошибка refresh → navigate('/').

setup-page.tsx: если roomId нет — `createRoom(client, { joinPolicy: 'guests' })` → `saveHostRoomId`; выбор приложения (quiz|lottery); quiz → `<QuizEditor onSubmit>`; lottery → радио `drawEligibility` (guests_allowed|verified, дефолт guests_allowed) → settings `{}` или `{ drawEligibility }`; submit → `configureRoom` → `activateRoom` → navigate('/host/console').

quiz-editor.tsx: форма (вопросы: текст, 2–6 вариантов, радио «правильный»; scoring base/step; minAnswerIntervalMs) → `buildQuizSettings` → `quizSettingsSchema.parse` на клиенте (та же схема, что серверная — дрейф невозможен структурно) → onSubmit(settings).

- [ ] **Step 3: Run green** (unit editor), typecheck/build

- [ ] **Step 4: Commit** — `feat(web): лендинг, OAuth-гейт организатора, setup комнаты (редактор квиза / лотерея)`

