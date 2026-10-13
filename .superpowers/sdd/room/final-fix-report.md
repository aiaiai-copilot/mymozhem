# Room lifecycle — final whole-branch review fixes

Branch: `phase-1-room-lifecycle`. Requirements: REQ-RT-005 (room lifecycle state machine),
REQ-CORE-003 (Room model), REQ-RWD-010 philosophy (DB invariant, not check-before-write),
REQ-DEV-006 (no Prisma preview features).

## What changed, per finding

### F1 (Important) — derive the soft-delete guard from the single source of truth

- `packages/core/src/room/room-state-machine.ts`: exported `DELETABLE_STATUSES` (was
  module-private). Added a comment explaining why it's now exported.
- `packages/core/src/room/room.service.ts`: `softDelete()`'s guarded `updateMany` now
  reads `status: { in: [...DELETABLE_STATUSES] }` instead of the hardcoded
  `status: { not: 'ACTIVE' }`. The pure module is now the only place the deletable set is
  spelled out; the SQL guard derives from it.
- Did NOT refactor `transition()`/`softDelete()` into a shared helper and did NOT switch
  to `updateManyAndReturn` — both explicitly out of scope per the plan (separate deferred
  follow-ups).

### F2 (Important) — bind the Prisma enum to the domain union at compile time

- `packages/core/src/room/room.service.ts`: added a compile-time parity assertion:
  ```ts
  import type { Room, $Enums } from '@prisma/client';
  ...
  type RoomStatusParity = [RoomStatus] extends [$Enums.RoomStatus]
    ? [$Enums.RoomStatus] extends [RoomStatus]
      ? true
      : never
    : never;
  void (true satisfies RoomStatusParity);
  ```
  Chose `void (true satisfies RoomStatusParity);` (a statement, not a variable
  declaration) instead of `const _parity: _Parity = true;` from the plan's sketch. I
  confirmed empirically (temporary scratch file + `pnpm --filter @mymozhem/core run lint`)
  that the `const _parity = true` form **is** flagged by
  `@typescript-eslint/no-unused-vars` ("'_parity' is assigned a value but never used") in
  this repo's `eslint.config.js`, while the `satisfies`-based statement form is not — it
  declares no binding, so there is nothing for `no-unused-vars` to flag, and it remains
  fully load-bearing (see bite-test below). No eslint-disable was added anywhere, and
  `eslint.config.js` was not touched.
- `packages/core/src/room/room-state-machine.ts`: made `canTransition` total —
  `ROOM_TRANSITIONS[from]` is looked up with a `?? EMPTY_TRANSITIONS` fallback to an empty
  `ReadonlySet<RoomStatus>`, so an out-of-domain `from` degrades to `false` (and, via
  `assertTransition`, to a typed `RoomTransitionError`/`ROOM_TRANSITION_INVALID`) instead
  of throwing an untyped `TypeError: Cannot read properties of undefined (reading 'has')`.
- Added a unit test in `room-state-machine.spec.ts` proving the total-lookup fallback:
  casts a fabricated `'ARCHIVED'` value through `as unknown as RoomStatus` and asserts
  `canTransition` returns `false` and `assertTransition` throws `RoomTransitionError`
  rather than crashing.

**F2 bite-test (see Verification below for full output):** temporarily added a 5th enum
member (`ARCHIVED`) to `RoomStatus` in `schema.prisma`, ran `prisma generate`, and
confirmed `pnpm --filter @mymozhem/core run typecheck` failed with:
```
src/room/room.service.ts(21,12): error TS1360: Type 'true' does not satisfy the expected type 'never'.
```
— i.e. it fails exactly at the parity-assertion line, not somewhere unrelated. Then
reverted `schema.prisma` to the original 4-member enum, re-ran `prisma generate`, and
confirmed `pnpm --filter @mymozhem/core run typecheck` passed cleanly, and
`git diff packages/core/prisma/schema.prisma` is empty (fully reverted).

### CHECK constraint (owner decision) — DB invariant for soft-delete/ACTIVE exclusion

- Amended the **existing** migration file (not a new migration) —
  `packages/core/prisma/migrations/20260718061612_room_lifecycle/migration.sql` — adding:
  ```sql
  ALTER TABLE "room"."Room" ADD CONSTRAINT "Room_softdelete_not_active"
    CHECK ("deletedAt" IS NULL OR "status" <> 'ACTIVE');
  ```
  Safe to amend in place per owner decision: this migration has never been applied to any
  persistent database (only ephemeral Testcontainers Postgres instances), and the branch
  has never been pushed.
- `schema.prisma` was **left unchanged** — see "CHECK constraint mirrored?" below for why.
- Added two new integration tests in a new `describe('Room CHECK constraint: soft-delete
  is incompatible with ACTIVE', ...)` block in `room.service.int-spec.ts`, using
  `$executeRawUnsafe` to go around `RoomService` (which can never produce a violating
  write) and prove the database itself rejects the violation:
  1. `rejects an UPDATE that sets deletedAt on an ACTIVE room, at the database level` —
     creates and activates a room via the service, then raw-SQL `UPDATE`s `deletedAt` on
     it directly; asserts the promise rejects with a message matching
     `/Room_softdelete_not_active/`, and that the row is unaffected afterward (`deletedAt`
     still null, `status` still `ACTIVE`).
  2. `rejects an INSERT of a row that is both ACTIVE and soft-deleted, at the database
     level` — raw-SQL `INSERT`s a row with `status='ACTIVE'` and `deletedAt=now()`
     directly; asserts the same rejection.

**CHECK constraint mirrored in `schema.prisma`? SQL-only — left the schema alone.**
Prisma ORM (pinned `^7.6.0`, resolved `7.8.0` in the lockfile) has **no** `@@check`
schema attribute at all, stable or preview — confirmed via `grep -rln
"@@check\b|checkConstraint" node_modules/.pnpm/prisma@7.8.0*` (no hits) and corroborated
by the still-open upstream feature request (prisma/prisma#3388, "Support SQL Check
constraints"). Since REQ-DEV-006 forbids preview features and Prisma doesn't offer this
even as one, there is nothing to mirror; the SQL migration is authoritative, exactly as
the plan anticipated for this case.

### m5 (Minor) — retitle the concurrency test

- `room.service.int-spec.ts`: retitled
  `'two competing cancels on one room: exactly one wins, the other conflicts'` to
  `'two competing cancels on one room: exactly one wins, the other is rejected'`.
  Assertion and the comment above it were not touched.

### Minor #3 — assert soft-delete orthogonality

- `room.service.int-spec.ts`, in the `'soft-deletes in DRAFT/COMPLETED/CANCELLED, refuses
  in ACTIVE'` test: after soft-deleting the cancelled room, added
  `expect(deleted.status).toBe('CANCELLED')` alongside the existing `deletedAt` assertion,
  proving `softDelete()` does not touch `status` (REQ-RT-005: "удаление не является
  статусом").

## Files changed

- `packages/core/prisma/migrations/20260718061612_room_lifecycle/migration.sql`
- `packages/core/src/room/room-state-machine.ts`
- `packages/core/src/room/room-state-machine.spec.ts`
- `packages/core/src/room/room.service.ts`
- `packages/core/src/room/room.service.int-spec.ts`

`packages/core/prisma/schema.prisma` was touched only transiently for the F2 bite-test and
is confirmed fully reverted (`git diff` empty for that file); the Prisma client was
regenerated after reverting.

## Verification output

### 1. `pnpm --filter @mymozhem/core run test:int`

```
PASS src/room/room.service.int-spec.ts (8.805 s)
PASS src/testing/harness.int-spec.ts

Test Suites: 2 passed, 2 total
Tests:       11 passed, 11 total
```
Each of the two describe-block DB setups in `room.service.int-spec.ts` applied the
migration for real via `prisma migrate deploy` inside `startTestDb()` (logged: "1
migration found in prisma/migrations" / "Applying migration `20260718061612_room_lifecycle`"
/ "All migrations have been successfully applied.") against an ephemeral Testcontainers
Postgres — the constraint was genuinely created and genuinely exercised, not
short-circuited.

### 2. `pnpm run build && pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run boundary-check && pnpm run guardrails`

- `build`: 3/3 packages successful.
- `typecheck`: 5/5 tasks successful (sdk build+typecheck, core build+typecheck, server
  typecheck).
- `test`: sdk 10 suites/142 tests passed; core 5 suites/55 tests passed (includes the new
  `room-state-machine.spec.ts` totality test); server 1 suite/3 tests passed.
- `lint`: 3/3 packages clean, zero errors/warnings.
- `boundary-check`: "no dependency violations found (162 modules, 327 dependencies
  cruised)".
- `guardrails`: all three guardrail probes fired as expected (boundary-check on sdk→core
  import, eslint on module-level mutable export, boundary-check on apps→core
  src-internals import) — "All guardrails verified alive."

### 3. F2 bite-test (both halves)

- **Diverged** (5-member enum in `schema.prisma`, regenerated client):
  `pnpm --filter @mymozhem/core run typecheck` → **FAILED**:
  `src/room/room.service.ts(21,12): error TS1360: Type 'true' does not satisfy the
  expected type 'never'.`
- **Reverted** (back to the original 4-member enum, regenerated client):
  `pnpm --filter @mymozhem/core run typecheck` → **PASSED** (no output/errors).
- `git diff packages/core/prisma/schema.prisma` → empty, confirming full revert.

## Concerns

None outstanding. All fixes were applied within the stated scope (no refactor of the two
mutation methods, no `updateManyAndReturn` switch, no second migration, no eslint-disable,
no weakening of any rule). The one deviation from the plan's exact code sketch is the
`void (true satisfies RoomStatusParity);` form instead of `const _parity: _Parity = true;`
for the F2 assertion — necessary because the `const` form is genuinely flagged by this
repo's lint config (verified empirically, not assumed), and the plan explicitly asked to
resolve that without an eslint-disable while keeping the assertion load-bearing, which
this form does (proven by the bite-test).
