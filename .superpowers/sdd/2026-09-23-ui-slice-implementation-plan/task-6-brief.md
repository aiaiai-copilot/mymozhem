### Task 6: apps/web scaffold + boundary + static-serving + compose

**Files:**
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`
- Modify: `.dependency-cruiser.cjs` (2 правила), `scripts/verify-guardrails.mjs` (2 probe), `packages/core/src/config/config.schema.ts` (`WEB_STATIC_DIR`), `apps/server/src/main.ts` (static + SPA-fallback), `apps/server/package.json` (`@fastify/static`), `docker-compose.yml` (`WEB_STATIC_DIR`)
- Test: `apps/server/test/static-web.e2e-spec.ts`

**Interfaces:**
- Produces: workspace-пакет `@mymozhem/web` с turbo-тасками build/lint/typecheck/test; boundary-правила `web-only-through-sdk-and-app-packages`, `web-socketio-only-in-realtime`; прод-раздача SPA при заданном `WEB_STATIC_DIR`.

- [ ] **Step 1: Scaffold** — package.json:

```json
{
  "name": "@mymozhem/web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Зависимости — только через pnpm (точные версии зафиксирует lockfile, REQ-DEV-002):
```bash
pnpm --filter @mymozhem/web add react react-dom react-router-dom socket.io-client zod @mymozhem/sdk@workspace:* @mymozhem/app-quiz@workspace:* @mymozhem/app-lottery@workspace:*
pnpm --filter @mymozhem/web add -D vite @vitejs/plugin-react typescript vitest @types/react @types/react-dom
pnpm --filter @mymozhem/server add @fastify/static
```

vite.config.ts:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dev-proxy: браузер видит same-origin (дизайн §2) — CORS не нужен ни в dev, ни в проде.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/rooms': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  test: { environment: 'node', include: ['src/**/*.spec.ts'] },
});
```

tsconfig.json — extends `../../tsconfig.base.json`, `compilerOptions: { "jsx": "react-jsx", "module": "ESNext", "moduleResolution": "bundler", "types": ["vite/client"], "noEmit": true }`, `include: ["src"]`. (Поля базового конфига не дублировать; если конфликт — следовать базовому.)

index.html — `<div id="root"></div>` + `<script type="module" src="/src/main.tsx">`, `<meta name="viewport" content="width=device-width, initial-scale=1">` (mobile-first, дизайн §0.4).

main.tsx / App.tsx — router с 4 маршрутами-заглушками (`/`, `/host/*`, `/play/:code?`, `/screen/:code` → `<p>tbd</p>`; реальные страницы — батчи C/D). styles.css — минимальный reset.

- [ ] **Step 2: Boundary-правила** — в `.dependency-cruiser.cjs` после `app-only-through-sdk`:

```js
{
  name: 'web-only-through-sdk-and-app-packages',
  severity: 'error',
  comment: 'apps/web видит только контракт (sdk) и чистые app-пакеты; core — за границей (ADR-002).',
  from: { path: '^apps/web/src' },
  to: { path: '^packages/', pathNot: ['^packages/sdk/', '^packages/app-quiz/', '^packages/app-lottery/'] },
},
{
  name: 'web-socketio-only-in-realtime',
  severity: 'error',
  comment: 'socket.io-client — только в apps/web/src/realtime (зеркало REQ-RT-006 на клиенте).',
  from: { path: '^apps/web/src', pathNot: '^apps/web/src/realtime' },
  to: { path: 'node_modules/socket[.]io-client' },
},
```

Проверить, что depcruise парсит .tsx (конфиг уже круизит TS; при необходимости — минимальная правка options). `pnpm run boundary-check` зелёный.

- [ ] **Step 3: Guardrails probes** — в `verify-guardrails.mjs` по существующему паттерну (writeFileSync → expectFailure → rmSync в finally):

```js
// 6) Web-boundary probe: apps/web импортирует core (forbidden).
// 7) Web-socket probe: socket.io-client вне src/realtime (forbidden).
//    Обоим — относительные импорты/прямой пакетный spec по прецеденту probes 3–5.
```

`pnpm run guardrails` — оба probe'а firing.

- [ ] **Step 4: config** — `WEB_STATIC_DIR: z.string().min(1).optional()` в config.schema.ts с комментарием (UI-срез: same-origin SPA; не задан → статика не раздаётся, поведение прежнее).

- [ ] **Step 5: Failing e2e static-serving** — `apps/server/test/static-web.e2e-spec.ts` (паттерн transport.e2e: поднять app с конфиг-override `WEB_STATIC_DIR` на tmp-директорию с index.html-маркером):

```ts
it('GET / → index.html (SPA)')
it('GET /host/console (не-API GET) → index.html (SPA fallback)')
it('GET /rooms/nonexistent (API-путь) → JSON 404, НЕ index.html')
it('GET /socket.io/... → не index.html')
```

- [ ] **Step 6: Run red → implement main.ts** (после регистрации CORS, до listen):

```ts
  // UI-срез (дизайн §2): same-origin раздача SPA из того же Docker-артефакта.
  // WEB_STATIC_DIR не задан → статики нет, поведение прежнее (dev/test).
  if (config.WEB_STATIC_DIR) {
    await app.register(fastifyStatic, { root: config.WEB_STATIC_DIR });
    // SPA-fallback только для не-API GET: API-404 обязаны оставаться JSON (Review Focus 5).
    const API_PREFIXES = ['/rooms', '/auth', '/health', '/socket.io'];
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? '';
      if (req.raw.method === 'GET' && !API_PREFIXES.some((p) => url.startsWith(p))) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ code: 'NOT_FOUND' });
    });
  }
```

Run green: `pnpm build && pnpm --filter @mymozhem/server test -- static-web`.

- [ ] **Step 7: compose + turbo** — `docker-compose.yml` server.environment += `WEB_STATIC_DIR: /app/apps/web/dist`. Dockerfile не меняется (build-стейдж `pnpm run build` собирает web турбо-таской; runtime копирует весь /app). Проверить `pnpm run build && pnpm run typecheck && pnpm run lint` — зелёные с новым пакетом.

- [ ] **Step 8: Commit** — `feat(web): scaffold apps/web (Vite+React) + boundary-правила + same-origin static-serving (UI-срез)`

