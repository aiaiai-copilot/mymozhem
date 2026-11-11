### Task 8: Play: busy-состояние и честные тексты отказа ответа

**Files:**
- Modify: `apps/web/src/pages/play/play-page.tsx` (answerErrorText :~35-48, submitAnswer :256-263, рендер кнопок вариантов)
- Test: `apps/web/src/pages/play/` — текст-маппинг выносится в чистую экспортируемую функцию (прецедент: open-question-label.ts); spec рядом

**Interfaces:**
- Consumes: коды `NOT_CONNECTED`/`PUBLISH_TIMEOUT` из T1.
- Produces: `answerErrorText` += кейсы NOT_CONNECTED/PUBLISH_TIMEOUT → «Нет подтверждения ответа — проверьте, не засчитан ли он, и нажмите ещё раз.» (решение 7; финальная редакция §4). Busy: `answerSubmitting: boolean` — кнопки вариантов disabled + индикация на время полёта.

- [ ] **Step 1: Падающий тест** — текст-маппинг: `answerErrorText(new ApiError('NOT_CONNECTED', 0))` и `('PUBLISH_TIMEOUT', 0)` → строка содержит «Нет подтверждения»; неизвестный код → прежний честный код; TypeError → «Ошибка сети…» (прежнее).

- [ ] **Step 2: Прогон** — FAIL.

- [ ] **Step 3: Реализация** — маппинг + busy: `submitAnswer` ставит `setAnswerSubmitting(true)` до publish, сброс в `finally`; disabled на кнопках вариантов пока `answerSubmitting`; визуальная индикация «Отправляю…» по дисциплине страницы.

- [ ] **Step 4: Прогон** — PASS; гейты.

- [ ] **Step 5: Commit** — `fix(web): ответ участника — busy-состояние и честный отказ «нет подтверждения» (находка Н1)`.

