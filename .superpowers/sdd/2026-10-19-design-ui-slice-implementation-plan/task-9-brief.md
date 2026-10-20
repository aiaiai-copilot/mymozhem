### Task 9: Консоль — каркас, игра, reveal, «Квиз окончен»

**Files:**
- Modify: `apps/web/src/pages/host/console-page.tsx`, `apps/web/src/pages/host/quiz-controls.tsx`
- Delete: `apps/web/src/components/standings.tsx` (последний потребитель мигрирует здесь; play/screen ушли в T7/T8)
- Create: `apps/web/src/pages/host/open-question-label.ts` (или в quiz-controls — чистая функция)
- Test: `apps/web/src/pages/host/quiz-controls.spec.ts` (расширение), `apps/web/src/pages/host/console-page.spec.ts` (расширение)
- Эталоны: `console-reveal-final-button.html`, `console-phone-landscape-v2.html`, `console-quiz-finished.html`, `console-empty-long-errors-v2.html`

**Interfaces:**
- Consumes: T4 (палитра консоли, кнопки), T5, T6, T3 (`durationSec`), питание `pinnedAppId` (console-page:69-77) не меняется.
- Produces: `openQuestionLabel(index: number, durationSec: number | null): string` — `'Открыть вопрос N'` + ` (30 с)` при числе, без суффикса при null (Review Focus 4). Иерархия консоли: статус → момент → действие.

- [ ] **Step 1: Failing test** — `openQuestionLabel`: (2, 30) → «Открыть вопрос 3 (30 с)»; (2, null) → «Открыть вопрос 3».
- [ ] **Step 2:** Каркас: палитра консоли (фон/панели/полоса комнаты), иерархия «статус → момент → следующее действие», ландшафт-правило — `@media (orientation: landscape) and (max-height: 400px)`: две колонки, действия справа; первый экран = статус + момент + главная кнопка без прокрутки.
- [ ] **Step 3:** Игра: таймер (useQuestionTimer) + счётчик ответов в блоке момента; главная кнопка закрытия. Тихая «Завершить событие» внизу (`.btn-quiet`), не блокируется наградами (REQ-RWD-009).
- [ ] **Step 4:** Reveal: ответ плашкой, разбор «верно/неверно/не успели», ростер = RaceTracks с приростом (`lastRoundGains`), топ-4 + «Ещё N» — разворот полного списка toggle (локальное состояние, I-5); главная кнопка `openQuestionLabel(next, durationSec)`.
- [ ] **Step 5:** «Квиз окончен» (`quiz.finished && status === 'ACTIVE'`): событие живо, главная кнопка «Завершить событие», подсказка невручённых наград — только если есть невручённые (п. 18).
- [ ] **Step 6:** Удалить `standings.tsx` и его импорты; промежуточное табло консоли = RaceTracks.
- [ ] **Step 7:** Гейты web + `pnpm build` + core/server не тронуты (прогон `pnpm test` корня).
- [ ] **Step 8: Commit** `feat(web): консоль — каркас «пульт ведущего», игра/reveal с дорожками и таймером, экран «Квиз окончен»`.

---

## Батч D — редактор, розыгрыш, live-ростер (задачи 10–12)

