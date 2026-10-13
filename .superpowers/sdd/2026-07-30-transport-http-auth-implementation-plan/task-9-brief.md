### Task 9: apps/server — плагины, trustProxy, AppModule, health e2e env

**REQ:** REQ-SEC-008 (helmet/CORS), REQ-ID-006 (real-IP через trustProxy — parked minor), REQ-SEC-002 (env при boot), REQ-OPS-003.

**Files:**
- Modify: `apps/server/package.json` (+ `@fastify/cookie @fastify/cors @fastify/helmet`)
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/test/health.e2e-spec.ts`
- Modify: `docker-compose.yml` (JWT_SECRET для server)

- [ ] **Step 1: Зависимости**

```bash
pnpm --filter @mymozhem/server add @fastify/cookie @fastify/cors @fastify/helmet
```

- [ ] **Step 2: main.ts**

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { loadConfig } from '@mymozhem/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  // trustProxy — осознанное доверие X-Forwarded-For из конфига деплоя (REQ-ID-006,
  // parked minor): при false req.ip — непосредственный peer, XFF игнорируется.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: config.TRUST_PROXY }),
  );
  await app.register(fastifyCookie);
  await app.register(fastifyHelmet);
  // REQ-SEC-008: allowlist из конфига; пустой список = CORS-заголовки не выдаются.
  await app.register(fastifyCors, { origin: config.CORS_ORIGINS });
  await app.listen(config.PORT, '0.0.0.0');
}

void bootstrap();
```

- [ ] **Step 3: app.module.ts** — добавить `TransportModule` в imports (из `@mymozhem/core`).

- [ ] **Step 4: health.e2e-spec.ts — env + parked fix**

В `beforeAll`: `process.env.JWT_SECRET ??= 'health-e2e-secret-32-bytes-padding!';` И заменить placeholder `DATABASE_URL` на мёртвый порт (parked minor из handoff: 5432 — чужой `lt-pg`): `'postgresql://stub:stub@localhost:55999/stub'`. Плюс save/restore env (parked): сохранить исходные `DATABASE_URL`/`JWT_SECRET` в `beforeAll`, восстановить в `afterAll`.

- [ ] **Step 5: docker-compose.yml** — в `server.environment` добавить:
```yaml
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required (>=32 bytes)}
      CORS_ORIGINS: ${CORS_ORIGINS:-}
      TRUST_PROXY: ${TRUST_PROXY:-false}
```

- [ ] **Step 6: Прогнать server-тесты + typecheck всего монорепо**

Run: `pnpm build && pnpm --filter @mymozhem/server test && pnpm typecheck`
Expected: health e2e зелёный с новыми env.

- [ ] **Step 7: Commit**

```bash
git add apps/server docker-compose.yml pnpm-lock.yaml
git commit -m "feat(server): wire transport plugins and trustProxy, JWT_SECRET at boot (REQ-SEC-002, REQ-SEC-008)"
```

---

