### Task 5: Классификация rejoin на play + повтор по online

**Files:**
- Modify: `apps/web/src/pages/play/play-page.tsx` (rejoin :73-91)
- Test: `apps/web/src/state/guest-rejoin.spec.ts` (если классификацию выносим в чистую функцию — см. шаг 1)

**Interfaces:**
- Consumes: `isTerminalSessionFailure` (T3).
- Produces: чистая `rejoinFailureAction(e: unknown): 'terminal' | 'retry'` (export из play-page.tsx или guest-rejoin.ts — по дисциплине файла; предпочтительно guest-rejoin.ts рядом с rejoinAsGuest). Поведение play-page: terminal → прежний путь (clearGuest + форма); retry → `autoJoinPending` снова true («Входим…») + одноразовый слушатель `window.online` → `rejoin()`.

- [ ] **Step 1: Падающий тест** — `rejoinFailureAction(new ApiError('ROOM_JOIN_DENIED', 403)) === 'terminal'`; `rejoinFailureAction(new TypeError()) === 'retry'`; `rejoinFailureAction(new ApiError('HTTP_502', 502)) === 'retry'`.

- [ ] **Step 2: Прогон** — FAIL.

- [ ] **Step 3: Реализация** — функция в guest-rejoin.ts; в play-page `rejoin` catch-ветка раздваивается по ней. Retry-ветка: `setAutoJoinPending(true)` (экран «Входим…» вместо формы), `window.addEventListener('online', handler, { once: true })` где handler → `void rejoin()` — гард `rejoinInFlight` уже защищает от дублей (Review Focus 6). Комментарий: сеть лежит → ждём online, личность не трогаем (решение 4).

- [ ] **Step 4: Прогон** — PASS; гейты (wiring — typecheck, идиома «DOM-тестов нет»).

- [ ] **Step 5: Commit** — `fix(web): rejoin гостя не сгорает на сетевом обрыве — повтор по online (находка Н13)`.

