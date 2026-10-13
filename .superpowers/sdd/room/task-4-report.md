# Task 4 Report: RoomService — create, transitions, soft-delete

## What I implemented

- `packages/core/src/room/room.service.ts` — `RoomService`, a NestJS `@Injectable()` consuming `PrismaService` via constructor injection (no global state, REQ-CORE-004). Public surface:
  - `create(organizerId: string): Promise<Room>` — inserts a `DRAFT` row.
  - `transition(roomId: string, to: RoomStatus): Promise<Room>` — reads current row for existence/precise error selection, calls `assertTransition` from the pure state machine (Task 2), then performs an **atomic conditional `updateMany`** guarded by `WHERE id = :id AND status = :from AND deletedAt IS NULL`. Zero rows affected → `RoomConflictError`. The read never gates correctness — the `WHERE` clause does.
  - `activate` / `complete` / `cancel` — thin wrappers over `transition`.
  - `softDelete(roomId: string): Promise<Room>` — same read-then-guarded-write shape, using `assertDeletable` and a guarded `updateMany` (`deletedAt IS NULL AND status != 'ACTIVE'`).
- `packages/core/src/room/room.service.int-spec.ts` — 7 integration tests against a real ephemeral Testcontainers Postgres (via `startTestDb` from Task 3), covering: create yields DRAFT; all four legal transition paths persist; illegal transition rejected with `ROOM_TRANSITION_INVALID` and leaves the row unchanged; transition from a terminal status rejected; transition of a missing room rejected with `ROOM_CONFLICT`; soft-delete allowed in DRAFT/COMPLETED/CANCELLED and refused in ACTIVE; a soft-deleted room is inert to further transitions (`ROOM_CONFLICT`).

Both files match the brief's verbatim content exactly — no deviations were needed since all Task 1–3 dependencies (`room.errors.ts`, `room-state-machine.ts`, Prisma `Room` model/migration, `startTestDb`) were already present and matched the brief's stated interfaces exactly.

## What I tested and the results

- Targeted integration run: `pnpm --filter @mymozhem/core run test:int -- room.service` → 7/7 passed.
- Full integration lane: `pnpm --filter @mymozhem/core run test:int` → 2 suites (`room.service.int-spec.ts` + pre-existing `harness.int-spec.ts`), 8/8 passed, pristine output.
- Full gate set: `pnpm run build && pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run boundary-check` — all green.
  - `build`: 3/3 packages successful.
  - `typecheck`: 5/5 tasks successful.
  - `test` (unit lane, excludes `*.int-spec.ts`): 5 suites / 54 tests in `@mymozhem/core`, plus sdk (142) and server (3) — all passed. Confirms unit/integration lane separation holds.
  - `lint`: clean, no warnings.
  - `boundary-check` (dependency-cruiser): "no dependency violations found (159 modules, 309 dependencies cruised)".

## TDD Evidence

**RED** — before writing `room.service.ts`:
```
$ pnpm --filter @mymozhem/core run test:int -- room.service
FAIL src/room/room.service.int-spec.ts
  ● Test suite failed to run
    src/room/room.service.int-spec.ts:2:29 - error TS2307: Cannot find module './room.service' or its corresponding type declarations.
    2 import { RoomService } from './room.service';
                                  ~~~~~~~~~~~~~~~~
Test Suites: 1 failed, 1 total
Tests:       0 total
```
Expected failure — the brief anticipated exactly "cannot find module `./room.service`". Confirms the test file was in place and exercising a real (missing) dependency, not a trivial/tautological failure.

**GREEN** — after writing `room.service.ts`:
```
$ pnpm --filter @mymozhem/core run test:int -- room.service
PASS src/room/room.service.int-spec.ts
  RoomService lifecycle
    ✓ create() yields a DRAFT room (31 ms)
    ✓ persists each legal transition (35 ms)
    ✓ rejects an illegal transition with ROOM_TRANSITION_INVALID (4 ms)
    ✓ rejects further transitions from a terminal status (8 ms)
    ✓ rejects transition of a missing room with ROOM_CONFLICT (3 ms)
    ✓ soft-deletes in DRAFT/COMPLETED/CANCELLED, refuses in ACTIVE (20 ms)
    ✓ a soft-deleted room is inert (transitions conflict) (6 ms)
Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
```

## Files changed

- `packages/core/src/room/room.service.ts` (new)
- `packages/core/src/room/room.service.int-spec.ts` (new)

Commit: `8517cec` — "feat(core): RoomService lifecycle via atomic guarded update (REQ-RT-005, REQ-CORE-006)"

`git status --short` before staging showed only these two new files — no unrelated changes were swept into the commit.

## Self-review findings

- **Completeness against brief:** implemented exactly the interface listed (`create`, `transition`, `activate`/`complete`/`cancel`, `softDelete`), no more, no less.
- **Naming:** consistent with existing module conventions (`RoomService`, mirrors `PrismaService`/other `*.service.ts` files already in the repo).
- **YAGNI:** verified against the brief's explicit "Seams NOT to be built" list — no lifecycle event emission, no appSettings/pin/freeze, no organizer REGISTERED/FK check, no transition authorization, no HTTP surface, no room code/policies, no log sealing. Grepped the two new files for `eslint-disable`, `ts-ignore`, `: any`, `TODO`/`FIXME` — none found.
- **Test quality:** all 7 tests exercise `RoomService` against a real ephemeral Postgres container (Testcontainers) through `PrismaService`, not mocks. Assertions check both the returned `Room` row and (in one case) an independent re-read via `db.prisma.room.findUnique` to confirm the DB-persisted state, not just the in-memory return value.
- **Test output cleanliness:** both the targeted and full integration runs, plus the full gate set, produced pristine output — no warnings, no skipped tests, no console noise beyond expected Prisma migration-apply logging from `startTestDb`.
- **Architectural fidelity:** confirmed the atomic-guarded-update design is followed literally — `transition`'s read is used only to select a precise `RoomTransitionError` message for an existing room; the `updateMany` `WHERE id AND status = current.status AND deletedAt IS NULL` is what actually enforces correctness under concurrency, exactly as directed. Same pattern in `softDelete`.

## Issues or concerns

None. Task 4 is complete, all specified tests pass against a real database, and all repository CI gates (build, typecheck, unit test, lint, boundary-check) are green.
