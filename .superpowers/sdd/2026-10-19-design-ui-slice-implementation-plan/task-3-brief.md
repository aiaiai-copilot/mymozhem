### Task 3: app-quiz v3 — `durationSec` + серверный `openedAt`

**Files:**
- Modify: `packages/app-quiz/src/quiz-settings.ts:7` (элемент вопроса), `packages/app-quiz/src/quiz-events.ts:4`, `packages/app-quiz/src/quiz-handlers.ts:31-47` (openQuestion), `packages/app-quiz/src/quiz-state.ts:36-45`, `packages/app-quiz/src/quiz-manifest.ts:14`
- Test: `packages/app-quiz/src/quiz-manifest.contract.spec.ts`, `packages/app-quiz/src/quiz-handlers.spec.ts`, `packages/app-quiz/src/quiz-state.spec.ts`
- Ripple: `apps/web/src/state/fixtures/quiz-log.fixture.ts` (:16 manifestVersion, :20-24/:54-58 question.opened), `packages/app-quiz/src/quiz-manifest.contract.spec.ts:42-45` (пин версии)

**Interfaces:**
- Produces: `QUIZ_MANIFEST_VERSION = 3`; элемент вопроса `durationSec: z.number().int().min(5).max(600).nullable().default(30)` (input-режим регистрации — ключ необязателен на гейте, C-9.1; `null` = «без лимита»); `questionOpenedPayload = strictObject({ questionIndex: int≥0, openedAt: z.iso.datetime().optional() })`; коммит `question.opened` всегда несёт `openedAt = ctx.now` (перезапись клиентского); `QuizState.openedAt` = `payload.openedAt ?? event.recordedAt`. Потребители: T5 (таймер), T9 (кнопка с длительностью), T10 (редактор).
- Эффект редеплоя: реестр знает только v3; комнаты quiz@2 после редеплоя → `APP_MANIFEST_UNKNOWN` на dispatch (принято дизайном §13, прецедент lottery@1).

- [ ] **Step 1: Failing tests** — `quiz-manifest.contract.spec.ts`: версия 3; appSettings-кейсы: `durationSec` опущен — валидно (input-режим), `3` — невалидно, `600` — валидно, `601` — невалидно, `null` — валидно; `question.opened` payload: `{questionIndex}` валидно, `{questionIndex, openedAt: ISO}` валидно, extra key невалидно (strict сохранён).
- [ ] **Step 2: Failing tests** — `quiz-handlers.spec.ts`: коммит `question.opened` несёт `openedAt === ctx.now` (exact-match ожидания :104-110, :405-420 обновить); клиентский `openedAt` в publish перезаписывается `ctx.now` (REQ-RT-009). `quiz-state.spec.ts`: `openedAt` из payload при наличии; fallback на `event.recordedAt` при отсутствии.
- [ ] **Step 3:** `pnpm --filter @mymozhem/app-quiz test` — RED.
- [ ] **Step 4:** Реализация по Interfaces (схемы, handler, reducer, константа версии).
- [ ] **Step 5:** GREEN app-quiz; `pnpm --filter @mymozhem/app-quiz build`.
- [ ] **Step 6: Риплы.** `quiz-log.fixture.ts` (web): `manifestVersion: 3`, `question.opened` += `openedAt`. Прогоны: `pnpm --filter @mymozhem/web test`, `pnpm build && pnpm --filter @mymozhem/server test` (quiz.e2e / quiz-points едут на константе — проверить :8/:180/:186/:288-300), `pnpm test:int`.
- [ ] **Step 7: Commit** `feat(app-quiz): манифест v3 — durationSec вопроса (5–600|null, дефолт 30) + серверный openedAt в question.opened`.

---

## Батч B — визуальный фундамент и вычислимое (задачи 4–6)

