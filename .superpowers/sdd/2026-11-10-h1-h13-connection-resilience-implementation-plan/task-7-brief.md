### Task 7: Затемнение нефокусного окна (play + console)

**Files:**
- Create: `apps/web/src/state/focus-dim.ts`, `apps/web/src/components/focus-dim.tsx`, `apps/web/src/state/use-focus-dim.ts`
- Modify: `apps/web/src/styles/tokens.css`, `apps/web/src/styles/transitions.css`, `apps/web/src/pages/play/play-page.tsx`, `apps/web/src/pages/host/console-page.tsx`
- Test: `apps/web/src/state/focus-dim.spec.ts`, `apps/web/src/styles/tokens.spec.ts` (fs-ассерты по прецеденту)

**Interfaces:**
- Consumes: ничего из предыдущих задач.
- Produces: `createFocusDimTracker(): { dimmed(): boolean; onBlur(): void; onFocus(): void; onVisibility(visible: boolean): void }` — dimmed ⟺ blurred && visible (Review Focus 4); `<FocusDim />` — null или оверлей `div.focus-dim` (`pointer-events: none`, решение 1) с текстом «Окно неактивно — кликните, чтобы продолжить» (черновик §4, финал на приёмке); `useFocusDim(): boolean`; CSS-класс `.focus-dim` + токен `--focus-dim-veil` (кандидат с комментарием, идиома среза).

- [ ] **Step 1: Падающие тесты** — трекер: начальное false; blur+visible → true; blur+hidden → false; focus → false; hidden→visible при удержанном blur → true; повторный blur без focus — без изменений.

- [ ] **Step 2: Прогон** — FAIL.

- [ ] **Step 3: Реализация** — трекер (чистый), хук (blur/focus на window, visibilitychange на document, cleanup), компонент, стили: `position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--focus-dim-veil); pointer-events: none; z-index` выше контента; RM-блок: без transition/animation на `.focus-dim`.

- [ ] **Step 4: Монтирование** — `{dimmed && <FocusDim />}` в корне play-page (scene-контур) и console-page. Проектор НЕ трогаем (решение 2).

- [ ] **Step 5: tokens.spec** — fs-ассерт определения `--focus-dim-veil` и отсутствия сырого литерала в transitions.css (прецедент regex из среза).

- [ ] **Step 6: Прогон** — PASS; гейты.

- [ ] **Step 7: Commit** — `feat(web): затемнение нефокусного окна на play/console — съеденный macOS клик получает видимый смысл (находка Н1)`.

