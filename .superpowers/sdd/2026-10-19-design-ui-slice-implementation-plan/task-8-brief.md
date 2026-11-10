### Task 8: Контур проектора (`/screen`)

**Files:**
- Modify: `apps/web/src/pages/screen/screen-page.tsx` (старые `.screen-question`/`.screen-options` из base.css заменяются финальными стилями)
- Эталоны: `projector-options-no-lines.html`, `projector-final-winners-large.html`, `projector-long-content.html`, `timer-projector-participant.html`, `tracks-scene-with-logo.html`

**Interfaces:**
- Consumes: T4, T5, T6, `Logo` (T7).
- Produces: проекторная раскладка (без интерактива).

- [ ] **Step 1:** Каркас: фон сцены, логотип 22px золотом левый верхний на всех экранах (включая вопрос с таймером — дизайн п. 17).
- [ ] **Step 2:** Вопрос: Oranienbaum 38px, таймер 56px золотом справа вверху (`--gold`, tabular-nums, по мокапу), варианты — две колонки (grid 1fr 1fr), отступ перед вариантами 35px, без золотых вертикальных линий; компактная плотность при длинном контенте (мокап `projector-options-no-lines`).
- [ ] **Step 3:** Reveal: «Правильный отвѣтъ» слева, дорожки справа — `topNWithRest(…, 4)` + «ещё N».
- [ ] **Step 4:** Финал: топ-5 + «+ ещё N участников»; победители — центрированный блок справа (заголовок 32px, имена 24px); **без розыгрыша блок победителей не рендерится, табло центрируется на всю зону** (дизайн п. 18).
- [ ] **Step 5:** Гейты web (test/typecheck/lint/build).
- [ ] **Step 6: Commit** `feat(web): контур проектора по дизайн-срезу (логотип, таймер 56px, дорожки топ-4/топ-5, финал без розыгрыша)`.

