### Task 12: wiring — квиз в composition root

**Files:**
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/package.json` (dep `@mymozhem/app-quiz: workspace:*`)

**Interfaces:**
- Consumes: `createQuizApp` (Task 11), `AppRegistryModule.register` (Task 5), `AppRuntimeModule.register` (Task 6).

- [ ] **Step 1: Implement**

`app.module.ts`:

```typescript
import { createQuizApp } from '@mymozhem/app-quiz';

const quiz = createQuizApp();

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AppRegistryModule.register([quiz.manifest]),
    AppRuntimeModule.register([quiz.runtime]),
    RoomModule,
    IdentityModule,
    MembershipModule,
    RealtimeModule,
    TransportModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Run — GREEN**

Run: `pnpm install && pnpm build && pnpm typecheck && pnpm --filter @mymozhem/server test`
Expected: PASS (существующие e2e на override'ах не затронуты; `realtime.e2e` override'ит оба токена своими — Quiz в них не участвует).

- [ ] **Step 3: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): квиз в composition root — манифест и рантайм-модуль через register

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

