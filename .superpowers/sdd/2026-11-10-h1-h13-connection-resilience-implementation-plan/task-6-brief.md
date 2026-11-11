### Task 6: Проактивный refresh по пробуждению

**Files:**
- Modify: `apps/web/src/state/session.ts` (decodeAccessClaims :5-15)
- Create: `apps/web/src/state/wake-refresh.ts`
- Modify: `apps/web/src/state/use-room-binding.ts` (onWake :72-77)
- Modify: `apps/web/src/pages/host/host-gate.tsx`, `host-login-page.tsx`, `setup-page.tsx` (монтирование хука)
- Test: `apps/web/src/state/wake-refresh.spec.ts`, `apps/web/src/state/session.spec.ts` (фикстуры += exp)

**Interfaces:**
- Consumes: `createFocusRefetcher` (focus-refetch.ts), `SessionStore.refresh`.
- Produces:
  - `decodeAccessClaims` возвращает `exp: number` (секунды, обязательное — серверные токены всегда с exp; фикстуры session.spec.ts дополняются);
  - `accessTokenDueSoon(token: string | null, nowMs: number, thresholdMs?: number): boolean` — `null` → **false** (Review Focus 2: refresh без куки шумит «no refresh cookie»); malformed → false (декод бросает → ловим → false); `(exp*1000 - nowMs) < thresholdMs` → true;
  - `REFRESH_AHEAD_MS = 120_000` (exported);
  - `createSessionWakeRefresher(getToken, refresh, opts?: { thresholdMs?, minIntervalMs?, now?, onWake? }): () => void` — дедуп createFocusRefetcher внутри; due → `void refresh().catch(() => {}).finally(() => onWake?.())`, не due → `onWake?.()` сразу (refresh-then-kick порядок, дизайн §3(Г));
  - `useSessionWakeRefresh(session: SessionStore)` — хук, слушатели visibilitychange/focus/pageshow/online с cleanup.

- [ ] **Step 1: Падающие тесты** — dueSoon: null→false, свежий токен→false, истекающий→true, истёкший→true, malformed→false. createSessionWakeRefresher: due → refresh вызван, onWake ПОСЛЕ settle refresh; не due → onWake без refresh; refresh reject → onWake всё равно стреляет, исключение проглочено; двойной вызов в окне minInterval → один refresh (дедуп).

- [ ] **Step 2: Прогон** — FAIL.

- [ ] **Step 3: Реализация** — wake-refresh.ts + decodeAccessClaims += exp; use-room-binding: onWake заменяется на `createSessionWakeRefresher(() => tokens.getAccessToken(), () => tokens.refresh(), { onWake: () => { if (visible) conn.wakeUp(); } })` + `window.addEventListener('online', onWake)` (ретрай обрыва по online, дизайн §3(В)); cleanup += online.

- [ ] **Step 4: Монтирование** — `useSessionWakeRefresh(hostSession)` в host-gate, host-login-page, setup-page (room-страницы console/play/screen покрыты use-room-binding автоматически).

- [ ] **Step 5: Прогон** — PASS; полный сьют web зелёный (фикстуры exp!); гейты + `pnpm boundary-check`.

- [ ] **Step 6: Commit** — `feat(web): проактивный refresh по пробуждению — 401-цыпочки и warn-шум простоев сходят на нет (находка Н13)`.

---

## Батч C — focus-dim и UI-поверхности отказа

