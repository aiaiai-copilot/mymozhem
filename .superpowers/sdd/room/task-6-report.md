# Task 6 Report: RoomModule wiring + core export + server registration

## What I implemented

Exactly the three steps specified in `task-6-brief.md`, verbatim:

1. **Created** `packages/core/src/room/room.module.ts`:
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
   Shape mirrors `PrismaModule`/`AppRegistryModule`/`HealthModule` exactly: imports the dependency module, provides + exports the service, no controller.

2. **Modified** `packages/core/src/index.ts` — appended four re-exports after the existing `app-registry.module` line:
   ```ts
   export * from './room/room.errors';
   export * from './room/room-state-machine';
   export * from './room/room.service';
   export * from './room/room.module';
   ```

3. **Modified** `apps/server/src/app.module.ts` — added `RoomModule` to the import from `@mymozhem/core` and to the `imports` array in `AppModule`, alongside `PrismaModule`, `HealthModule`, `AppRegistryModule`.

No controller, gateway, or HTTP surface was added — `RoomModule` provides/exports only `RoomService`.

## What I tested and results

Full gate set (brief step 4), run as a single chained command:
```
pnpm run build && pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run boundary-check && pnpm run guardrails
```

- **build** — 3/3 packages successful (`@mymozhem/sdk`, `@mymozhem/core`, `@mymozhem/server`).
- **typecheck** — 5/5 tasks successful (build deps + typecheck for all 3 packages).
- **test** — 5/5 tasks successful:
  - `@mymozhem/sdk`: 10 suites / 142 tests passed.
  - `@mymozhem/core`: 5 suites / 54 tests passed (includes `room-state-machine.spec.ts`).
  - `@mymozhem/server`: 1 suite / 3 tests passed — `test/health.e2e-spec.ts` (GET /health/live, /health/ready ×2) still green, confirming the health e2e (which stubs `PrismaService`) is unaffected by `RoomModule` now being registered in `AppModule`.
- **lint** — 3/3 packages, eslint clean.
- **boundary-check** (`depcruise apps packages --config .dependency-cruiser.cjs`) — "no dependency violations found (162 modules, 327 dependencies cruised)".
- **guardrails** (`node scripts/verify-guardrails.mjs`) — all 3 guardrails fired as expected: sdk→core import (dependency-cruiser), module-level mutable export (eslint), apps→core src-internals import (dependency-cruiser). "All guardrails verified alive."

All gates: **PASS**.

Integration lane (brief step 3 / task instruction 3):
```
pnpm --filter @mymozhem/core run test:int
```
Docker was confirmed running (`docker info` succeeded) before running. Testcontainers spun up ephemeral, isolated Postgres instances (ports 32877–32879, local-only), applied the `20260718061612_room_lifecycle` migration in schema `room`, and tore down cleanly. Result: **2 suites / 9 tests passed** (`src/room/room.service.int-spec.ts`, `src/testing/harness.int-spec.ts`). Nothing regressed.

## Files changed

- `packages/core/src/room/room.module.ts` (new)
- `packages/core/src/index.ts` (modified — 4 new export lines)
- `apps/server/src/app.module.ts` (modified — `RoomModule` added to import + `imports` array)

## Self-review

- Wiring is minimal and structurally identical to `PrismaModule`/`AppRegistryModule`/`HealthModule`'s established pattern — no invented conventions.
- Export surface matches the brief exactly (4 lines: `room.errors`, `room-state-machine`, `room.service`, `room.module`) — nothing extra exported.
- No controller, gateway, or HTTP route added — confirmed `RoomModule`'s `@Module()` decorator has only `imports`/`providers`/`exports`.
- Checked off the forbidden-seams list: no lifecycle event emission, no appSettings/pin/freeze, no organizer=REGISTERED/identity FK, no transition authorization, no HTTP surface, no room code/policies, no log sealing — none of these were touched.
- Diff reviewed via `git diff` before commit; confirmed only the three intended files were staged (`git add` targeted them explicitly, matching the brief's step 5, not `git add -A`).
- Pre-existing unstaged changes present at session start (`package.json`, `packages/core/package.json`, `packages/core/tsconfig.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `packages/core/jest.integration.config.js`, `packages/core/src/testing/`) — these predate this task (Task 5's integration-test harness scaffolding) and were deliberately left untouched/uncommitted, out of scope for Task 6.

## Issues or concerns

None. All gates green, integration lane green, commit created cleanly on `phase-1-room-lifecycle`. No deviation from the brief was needed.
