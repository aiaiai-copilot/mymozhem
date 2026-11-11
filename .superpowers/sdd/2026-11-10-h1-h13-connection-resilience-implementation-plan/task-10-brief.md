### Task 10: Busy-состояния REST-действий консоли и setup

**Files:**
- Modify: `apps/web/src/pages/host/members-panel.tsx` (exclude), `prizes-panel.tsx` (create/draw), `awards-panel.tsx` (fulfill/revoke), `setup-page.tsx` (submit)
- Test: существующие spec'ы панелей (members-panel.spec.ts, prizes-panel.spec.ts) — если чистая логика затронута; иначе typecheck

**Interfaces:**
- Consumes: T2 (таймаут гарантирует settle — busy не зависнет).
- Produces: единообразие: у каждой REST-кнопки in-flight гард (disabled + индикация «Отправляю…»/«Завершаем…» по месту), ошибка — через существующие поверхности панелей.

- [ ] **Step 1: Инвентаризация** — пройти панели, у каждого сетевого действия либо есть in-flight гард, либо добавить `pending` state: set перед вызовом, сброс в finally.
- [ ] **Step 2: Реализация** по списку шага 1; тексты отказов не меняются (поверхности есть).
- [ ] **Step 3: Прогон** — гейты web зелёные.
- [ ] **Step 4: Commit** — `fix(web): busy-состояния REST-действий консоли и setup (находка Н1)`.

