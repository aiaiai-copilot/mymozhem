### Task 7: Контур участника (`/play`)

**Files:**
- Modify: `apps/web/src/pages/play/play-page.tsx`, `apps/web/src/pages/play/join-form.tsx`
- Create: `apps/web/src/components/logo.tsx`
- Test: расширение существующих спеков чистых функций при касании (join-form.spec); unit для `myPlace`-интеграции уже в T6
- Эталоны: `participant-join-lobby-center-fix.html`, `participant-flow-layout-v2.html`, `participant-long-content.html`, `game-states.html`, `timer-projector-participant.html`, `tracks-scene-with-logo.html` (сессии 44/45)

**Interfaces:**
- Consumes: T4 (токены/кнопки), T5 (`useQuestionTimer`), T6 (`RaceTracks`, `lastRoundGains`, `myPlace`), T3 (`durationSec` из `appSettings.questions[i]`, `QuizState.openedAt` из payload).
- Produces: `<Logo contour="scene" size="participant" />` — «МЫ МОЖЕМЪ», `font-family: var(--font-logo)`, золото, 19px по центру вверху (все экраны контура, дизайн п. 17). Потребитель Logo также T8 (22px top-left) и T9.

- [ ] **Step 1:** Вход: заголовок «Входъ в игру» (Приложение A), поля `--input-scene` с золотыми подписями, кнопка «Играть» `.btn .btn-primary`? — НЕТ: сцена, вариант кнопки по мокапу входа (`participant-join-lobby-center-fix.html`), верхний отступ 34px.
- [ ] **Step 2:** Ожидание: центрирование `top: 50%` + `translateY(-50%)` относительно всей высоты (логотип/заголовок не влияют).
- [ ] **Step 3:** Вопрос: таймер 40px в верхней строке (при `durationSec !== null`), логотип, отступ перед вариантами 30px, варианты `.btn-scene` (поверхность, рост по высоте, переносы). Страничный скролл, без внутренних.
- [ ] **Step 4:** Reveal: вердикт «Верно!/Неверно./Вы не успели ответить.» + «+N очков», «Правильный отвѣтъ» (Приложение A), табло = `RaceTracks` полное с `highlightId` («это ты») и местом в шапке (`myPlace`).
- [ ] **Step 5:** Финал: полное табло дорожками + `Winners` только при наличии розыгрыша (дизайн п. 18: в логе есть `lottery.draw.completed`).
- [ ] **Step 6:** `pnpm --filter @mymozhem/web test && pnpm --filter @mymozhem/web typecheck && pnpm --filter @mymozhem/web lint`.
- [ ] **Step 7: Commit** `feat(web): контур участника по дизайн-срезу (вход/ожидание/вопрос с таймером/reveal с дорожками/финал)`.

