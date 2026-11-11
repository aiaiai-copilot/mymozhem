### Task 9: Console: busy и тексты для publish-команд и кнопок события

**Files:**
- Modify: `apps/web/src/pages/host/console-page.tsx` (commandErrorText :26-29, sendCommand :~160-180, complete/cancel), `apps/web/src/pages/host/quiz-controls.tsx`
- Test: `apps/web/src/pages/host/console-page.spec.ts` (прецедент существует)

**Interfaces:**
- Consumes: коды T1.
- Produces: `commandErrorText` += NOT_CONNECTED/PUBLISH_TIMEOUT → «Нет подтверждения команды — проверьте, не применилась ли она, прежде чем повторять.» (решение 7); busy: одна команда в полёте на QuizControls (кнопки команд disabled) + прежний `completing` распространяется текстом «Завершаем…» (уже есть disabled — добавить индикацию).

- [ ] **Step 1: Падающий тест** — commandErrorText кейсы NOT_CONNECTED/PUBLISH_TIMEOUT → «Нет подтверждения…»; прочее — прежнее.

- [ ] **Step 2: Прогон** — FAIL.

- [ ] **Step 3: Реализация** — маппинг; `commandPending: boolean` в console-page: sendCommand ставит/сбрасывает в finally, прокидывается в QuizControls пропом (disabled на кнопках команд); complete/cancel — прежний `completing` + текст занятости.

- [ ] **Step 4: Прогон** — PASS; гейты.

- [ ] **Step 5: Commit** — `fix(web): команды ведущего — busy и честный отказ «нет подтверждения» (находка Н1)`.

---

## Батч D — REST-контуры консоли и документация

