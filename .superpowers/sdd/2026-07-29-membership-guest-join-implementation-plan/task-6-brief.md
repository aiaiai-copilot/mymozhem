### Task 6: Экспорты, wiring приложения, полные гейты + живой boot

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `apps/server/src/app.module.ts`

**Interfaces:**
- Consumes: всё выше.
- Produces: публичный entrypoint `@mymozhem/core` с новыми модулями; приложение, в котором Nest поднимает MembershipModule/IdentityModule/ConfigModule; зелёный CI-эквивалент; доказанный boot с 6 миграциями.

- [ ] **Step 1: Экспорты core**

В `packages/core/src/index.ts` добавить после строки `export * from './config/config.schema';`:

```ts
export * from './config/config.tokens';
export * from './config/config.module';
```

и после room-блока:

```ts
export * from './identity/identity.service';
export * from './identity/identity.module';
export * from './membership/membership.errors';
export * from './membership/join-rate-limiter';
export * from './membership/membership.service';
export * from './membership/membership.module';
```

- [ ] **Step 2: AppModule сервера**

`apps/server/src/app.module.ts` — полная замена:

```ts
import { Module } from '@nestjs/common';
import {
  AppRegistryModule,
  HealthModule,
  IdentityModule,
  MembershipModule,
  PrismaModule,
  RealtimeModule,
  RoomModule,
} from '@mymozhem/core';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AppRegistryModule,
    RoomModule,
    IdentityModule,
    MembershipModule,
    RealtimeModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Полная лана гейтов из корня**

Run:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm boundary-check && pnpm guardrails && pnpm build
```

Expected: всё зелёное. `boundary-check` — 0 нарушений (зависимости room → membership → identity внутри core правилам не запрещены, конфиг depcruise не менялся — controller note).

- [ ] **Step 4: Живой boot docker-артефакта со свежей БД**

Run:

```bash
docker compose up --build -d
until curl -sf http://localhost:3000/health/ready >/dev/null; do sleep 2; done
docker compose exec -T postgres psql -U mymozhem -c "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at NULLS LAST;"
docker compose down -v
```

Expected: `/health/ready` → 200; в `_prisma_migrations` 6 строк, последняя `<timestamp>_membership_guest_join`; `down -v` убирает контейнеры и volume (хост-порт 5432/`lt-pg` не тронут — compose не публикует postgres наружу). Fallback, если psql-запрос не находит таблицу в `public` (multiSchema): `docker compose logs server 2>&1 | grep -i "membership_guest_join"`.

- [ ] **Step 5: Финальный коммит**

```bash
git add packages/core/src/index.ts apps/server/src/app.module.ts
git commit -m "feat(core): wire identity/membership modules into the app (REQ-ID-002)"
```

(Если Steps 3–4 потребовали правок — они коммитятся отдельно `fix(core): …` с REQ-тегом до этого коммита.)
