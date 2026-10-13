## Task 6: RoomModule wiring + core export + server registration

**Files:**
- Create: `packages/core/src/room/room.module.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/server/src/app.module.ts`

**Interfaces:**
- Consumes: `RoomService` (Task 4), `PrismaModule` (`packages/core/src/prisma/prisma.module.ts`).
- Produces: `RoomModule` (provides + exports `RoomService`); re-exported from `@mymozhem/core`.

- [ ] **Step 1: Create the module**

Create `packages/core/src/room/room.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RoomService } from './room.service';

@Module({
  imports: [PrismaModule],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}
```

- [ ] **Step 2: Export from the core entrypoint**

Add to `packages/core/src/index.ts`:

```ts
export * from './room/room.errors';
export * from './room/room-state-machine';
export * from './room/room.service';
export * from './room/room.module';
```

- [ ] **Step 3: Register in the server**

Edit `apps/server/src/app.module.ts` to add `RoomModule`:

```ts
import { Module } from '@nestjs/common';
import { AppRegistryModule, HealthModule, PrismaModule, RoomModule } from '@mymozhem/core';

@Module({
  imports: [PrismaModule, HealthModule, AppRegistryModule, RoomModule],
})
export class AppModule {}
```

- [ ] **Step 4: Verify build, typecheck, unit tests, e2e, boundary-check all green**

Run:
```bash
pnpm run build && pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run boundary-check && pnpm run guardrails
```
Expected: all PASS. `boundary-check` stays green (RoomService→PrismaService is an internal core dependency; no SDK or cross-module violation). The existing health e2e (which stubs PrismaService) still passes — `RoomModule` imports `PrismaModule`, and `RoomService` is not exercised by the health e2e.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/room/room.module.ts packages/core/src/index.ts apps/server/src/app.module.ts
git commit -m "feat(core): wire RoomModule and register it in the server (REQ-CORE-002)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

