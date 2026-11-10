### Task 4: `styles/` — токены, база, состояния, шрифты

**Files:**
- Create: `apps/web/src/styles/tokens.css`, `apps/web/src/styles/base.css`, `apps/web/src/styles/transitions.css`, `apps/web/public/fonts/` (woff2)
- Modify: `apps/web/src/main.tsx:5` (импорты), `apps/web/index.html` (`data-theme`), Delete: `apps/web/src/styles.css` (его `.screen-question`/`.screen-options` переезжают в base.css как есть — замена в T8)
- Test: `apps/web/src/styles/tokens.spec.ts`

**Interfaces:**
- Produces: токены (имена семантические, значения verbatim дизайн §4 + принятый мокап `component-states-live.html`): сцена `--scene-bg #0A252B, --scene-surface #1B3B40, --scene-surface-hover #23484D, --scene-surface-active #122E32, --gold #E6C77D, --scene-text #F6EDDC, --muted-scene #9DB8B2, --error-dark #F27668, --input-scene #A9BDB2, --track-fill #0F7B57, --track-canvas-dark #143138`; консоль `--console-bg #E3F0E9, --console-panel #F4F8F3, --console-strip #D7E8DE, --console-secondary #C4D8CC, --console-primary #10514F, --console-primary-hover #17685F, --console-primary-active #0A3E3B, --console-secondary-hover #B4CDBC, --console-secondary-active #A3BFA9, --ink #12343A, --muted #5A6B66, --error-light #A92820, --track-canvas-light #D5E2DA, --danger-hover #F3DCD2, --danger-active #ECCFC4`; тайминги `--t-hover 140ms, --t-press 60ms, --t-race 300ms`; шрифты `--font-logo` (до лицензии = `'Oranienbaum'`), `--font-display: 'Oranienbaum'`, `--font-body: 'PT Sans'`. transitions.css — кнопочная система из мокапа verbatim (`.btn`, `.btn-primary/-secondary/-quiet/-danger`, `.btn-scene`; hover только `@media (hover:hover) and (pointer:fine)`; active ≤60мс; focus-visible 3px offset 2px, на сцене золотой; disabled 0.55 без hover/active; reduced-motion гасит переходы). Точка темы: `<html data-theme="rybinsk">`, токены под `:root`, комментарий «вторая тема = переопределение токенов под `[data-theme=…]`» (готовность без пресетов, дизайн п. 5).
- Шрифты: woff2 Oranienbaum (400) и PT Sans (400, 700), кириллица, OFL — скачать с Google Fonts (только инструмент получения woff2; в рантайме обращений к Google нет) в `apps/web/public/fonts/`; `@font-face` в base.css, `font-display: swap`. Blagovest НЕ скачивать/не коммитить.

- [ ] **Step 1: Failing test** — `tokens.spec.ts` (node, `fs.readFileSync` tokens.css/transitions.css): каждый токен из Interfaces присутствует с точным значением; hover-блок обёрнут в `(hover: hover) and (pointer: fine)`; reduced-motion блок есть; `.btn` без `border` (grep-ассерт `border: none`).
- [ ] **Step 2:** `pnpm --filter @mymozhem/web test` — RED.
- [ ] **Step 3:** Файлы по Interfaces; woff2 скачаны и подключены; `main.tsx` импортирует три новых css вместо `styles.css`; `index.html` += `data-theme`.
- [ ] **Step 4:** GREEN + `pnpm --filter @mymozhem/web build` (vite подхватывает public/fonts).
- [ ] **Step 5: Commit** `feat(web): styles/ — токены, база, состояния, self-hosted шрифты (Oranienbaum/PT Sans, OFL)`.

