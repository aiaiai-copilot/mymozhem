### Task 16: Playwright smoke + CI

**Files:**
- Create: `apps/web/e2e/playwright.config.ts`, `apps/web/e2e/smoke.spec.ts`, `apps/server/scripts/e2e-web-seed.mjs`
- Modify: `apps/web/package.json` (`test:e2e`), `.github/workflows/ci.yml` (job e2e-web)

**Interfaces:**
- Consumes: запущенный docker-compose стенд (`WEB_STATIC_DIR` из Task 6); seed-скрипт по патерну `apps/server/scripts/create-room.mjs` (subpath-импорты dist, не barrel) — создаёт REGISTERED identity + сессию через `TokenService`, печатает JSON `{ refreshToken }`; cookie — `mm_refresh` (`REFRESH_COOKIE`).

- [ ] **Step 1: Seed-скрипт** — зеркало create-room.mjs + TokenService; usage: `node apps/server/scripts/e2e-web-seed.mjs --email=e2e@example.com` → stdout JSON.

- [ ] **Step 2: Smoke-сьют** (baseURL `http://localhost:3000`, workers 1, retries 1):

```ts
// 1) Организатор: context.addCookies mm_refresh (seed) → /host → create room →
//    редактор (1 вопрос, 2 варианта) → configure+activate → консоль, код комнаты виден.
// 2) Участник: новый context → /play/<code> → join → лобби; организатор open →
//    у участника варианты → ответ → «Ответ принят»; организатор close → участник: reveal/табло.
// 3) Экран: context → /screen/<code> → вопрос виден крупно после open.
// Один сьют, последовательные шаги тремя context'ами в одном test (shared room code).
```

- [ ] **Step 3: CI job e2e-web** — после build: `docker compose up -d --build` (JWT_SECRET из secrets/фиктивный тестовый), wait `/health/live`, `pnpm exec playwright install --with-deps chromium`, seed → `pnpm --filter @mymozhem/web test:e2e`, `docker compose down` (always). **Только локальный compose-стенд — никогда не против production.**

- [ ] **Step 4: Локальный зелёный прогон** — compose up, seed, `pnpm --filter @mymozhem/web test:e2e` зелёный; полный конвейер зелёный.

- [ ] **Step 5: Commit** — `test(web): Playwright smoke (host/play/screen) против compose-стенда + CI job`

