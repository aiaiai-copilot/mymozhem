### Task 12: /screen — проектор

**Files:**
- Create: `apps/web/src/pages/screen/screen-page.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: Tasks 7–11. Отличие от play: join с `role: 'spectator'`, read-only.

- [ ] **Step 1: Implement** — join по коду из `:code` (displayName фиксированный `'Экран'`; joinRequestSchema принимает role `'spectator'`) → тот же useRoomBinding → views: текущий вопрос крупно (`appSettings.questions[currentQuestion].text` + options), после reveal — `<Standings>`, финал — `<Standings>` + `<Winners>`. Без форм и кнопок.

- [ ] **Step 2: Run** — typecheck/build зелёные

- [ ] **Step 3: Commit** — `feat(web): проекторный экран /screen (spectator-join, read-only)`

---

## Батч D — организатор

