### Task 5: Таймер — чистая логика + хук

**Files:**
- Create: `apps/web/src/state/question-timer.ts`
- Test: `apps/web/src/state/question-timer.spec.ts`

**Interfaces:**
- Produces: `remainingSec(durationSec: number | null, openedAt: string | null, nowMs: number): number | null` — `null` duration («без лимита») → `null`; `null` openedAt → `null`; иначе `clamp(durationSec - floor((nowMs - Date.parse(openedAt))/1000), 0, durationSec)`. `formatTimer(sec: number): string` — `m:ss`. `useQuestionTimer(durationSec: number | null, openedAt: string | null): number | null` — setInterval 1000ms, cleanup; без DOM-теста (паттерн репо: чистая функция тестируется, хук — typecheck). Потребители: T7, T8, T9.

- [ ] **Step 1: Failing test** — кейсы: без лимита → null; не открыт → null; ровно 30 → `0:30`; стоит на нуле (`0:00`, без отрицательных); Review Focus 1 (openedAt 20 с назад при 30 → 10; openedAt час назад → 0); Review Focus 2 (openedAt в будущем → durationSec, не выше); `formatTimer(65)` → `1:05`.
- [ ] **Step 2:** `pnpm --filter @mymozhem/web test` — RED.
- [ ] **Step 3:** Реализация + хук.
- [ ] **Step 4:** GREEN, typecheck.
- [ ] **Step 5: Commit** `feat(web): question-timer — remainingSec/formatTimer/useQuestionTimer (тик 1 с, clamp 0..durationSec)`.

