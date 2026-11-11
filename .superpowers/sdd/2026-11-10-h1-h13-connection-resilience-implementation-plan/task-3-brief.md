### Task 3: Классификация отказов сессии

**Files:**
- Create: `apps/web/src/state/session-failure.ts`
- Test: `apps/web/src/state/session-failure.spec.ts`

**Interfaces:**
- Consumes: `ApiError` (`apps/web/src/api/api-error.ts`).
- Produces: `isTerminalSessionFailure(e: unknown): boolean` — `true` ⟺ `e instanceof ApiError && e.status >= 400 && e.status < 500`. Потребители — T4 (connect_error), T5 (rejoin). Таблица: 401 refresh → терминал; 403/404/409 join → терминал; 5xx/HTTP_5xx → временный; TypeError/AbortError/неизвестное → временный (дизайн §3(В), builder-check Q1).

- [ ] **Step 1: Падающий тест** — таблица кейсов: `new ApiError('SESSION_INVALID', 401)` → true; `new ApiError('ROOM_JOIN_DENIED', 403)` → true; `new ApiError('HTTP_502', 502)` → false; `new ApiError('PUBLISH_TIMEOUT', 0)` → false; `new TypeError('fetch failed')` → false; `new Error('boom')` → false.

- [ ] **Step 2: Прогон** — FAIL (модуль не существует).

- [ ] **Step 3: Реализация** — предикат с комментарием-таблицей классификации (дизайн §3(В): терминален только серверный отказ по существу; 5xx — инфраструктурный обрыв, кейс рестарта сервера посреди события).

- [ ] **Step 4: Прогон** — PASS; гейты.

- [ ] **Step 5: Commit** — `feat(web): классификация отказов сессии — терминален только 4xx (находка Н13)`.

---

## Батч B — сессионная машина (Н13) и проактивный refresh

