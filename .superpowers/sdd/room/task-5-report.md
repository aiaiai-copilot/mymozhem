# Task 5 Report: Concurrency / atomicity integration test

## What I implemented

Added a new top-level `describe('RoomService transition atomicity', ...)` block to
`packages/core/src/room/room.service.int-spec.ts`, following the same structure as
the existing `describe('RoomService lifecycle', ...)` block (own `TestDb` instance,
own `RoomService`, `beforeAll`/`afterAll` with a 120s timeout for container startup).

Per the owner's required deviation, the race is **`cancel()` vs `cancel()`** on a
single DRAFT room, not `activate()` vs `cancel()` as originally drafted in the brief.
The brief's original pairing is schedule-dependent (if the two calls serialize, the
second one legally transitions `ACTIVE → CANCELLED` and both succeed, failing the test
with no defect present). `cancel()` vs `cancel()` has exactly one winner under every
possible schedule:

- **Interleaved:** both reads see `DRAFT`, both pass `assertTransition`, both issue the
  guarded `UPDATE`; the atomic `WHERE id = ... AND status = 'DRAFT'` guard lets exactly
  one affect a row — the loser affects 0 rows and gets `RoomConflictError`.
- **Serialized:** the loser's read sees `CANCELLED` (already committed by the winner),
  which is terminal, so `assertTransition` itself throws `RoomTransitionError` before
  any UPDATE is issued.

The test asserts: exactly one `fulfilled`, exactly one `rejected`, the rejection
reason is an instance of the **base class** `RoomError` (not one specific subclass —
which subclass fires depends on the unobservable schedule), and the final persisted
status is `CANCELLED`. A comment above the test explains both branches and explicitly
warns against tightening the assertion to one subclass, per the deviation's
instruction not to reproduce the brief's incorrect "intermittent failure proves lack
of atomicity" claim.

Import list at the top of the file was extended with `RoomError` (base class), added
alongside the already-present `RoomTransitionError, RoomConflictError`.

## What I tested and results

`pnpm --filter @mymozhem/core run test:int -- room.service` — full file, run once to
confirm and then 5 additional consecutive runs to check for flakiness in the new race
test (all 5 also green, no variance observed):

```
PASS src/room/room.service.int-spec.ts (6.577 s)
  RoomService lifecycle
    ✓ create() yields a DRAFT room (30 ms)
    ✓ persists each legal transition (29 ms)
    ✓ rejects an illegal transition with ROOM_TRANSITION_INVALID (4 ms)
    ✓ rejects further transitions from a terminal status (6 ms)
    ✓ rejects transition of a missing room with ROOM_CONFLICT (2 ms)
    ✓ soft-deletes in DRAFT/COMPLETED/CANCELLED, refuses in ACTIVE (16 ms)
    ✓ a soft-deleted room is inert (transitions conflict) (4 ms)
  RoomService transition atomicity
    ✓ two competing cancels on one room: exactly one wins, the other conflicts (24 ms)

Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
```

Full gate set, run once before commit and re-confirmed after (build/typecheck/test
were fully cached the second time since the file was unchanged; lint and
boundary-check re-executed against the working tree either way):

- `pnpm run build` — 3/3 packages, success
- `pnpm run typecheck` — 5/5 tasks, success
- `pnpm run test` (unit tests, not the Testcontainers int-spec) — sdk 142/142, core
  54/54, server 3/3, all pass
- `pnpm run lint` — 3/3 packages, clean
- `pnpm run boundary-check` (`depcruise apps packages`) — "no dependency violations
  found (159 modules, 309 dependencies cruised)"

## Files changed

- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/room/room.service.int-spec.ts`
  — added `RoomError` import and the new `describe('RoomService transition
  atomicity', ...)` block (47 insertions, 1 line changed). This is the only file
  touched.

## Self-review

- **Does the test prove what it claims?** Yes. Traced both possible Postgres
  schedules by hand against `RoomService.transition`'s actual implementation
  (`findUnique` → `assertTransition` → guarded `updateMany` with
  `WHERE id, status: current.status, deletedAt: null`). Under READ COMMITTED (the
  Postgres default, no explicit transaction wrapping these calls), a concurrent
  `UPDATE` targeting the same row blocks until the first commits, then re-evaluates
  its `WHERE` clause against the post-commit row — so it is not possible for both
  `cancel()` calls to succeed, and not possible for both to fail. Exactly one
  fulfilled / one rejected is guaranteed by the guard, not by luck.
- **Would it pass for the wrong reason?** No plausible path found. Both branches
  (interleaved → `RoomConflictError`, serialized → `RoomTransitionError`) are
  legitimate proofs of the same underlying invariant (only one `CANCELLED`
  transition ever lands), and the assertion (`toBeInstanceOf(RoomError)`, the common
  base class) doesn't silently accept a defect — any error unrelated to the room
  domain would not be an instance of `RoomError` and would still fail the test.
- **Output pristine?** Yes — no console noise beyond the standard Prisma migration
  log lines already present for Task 4's block (each `describe` block owns its own
  ephemeral Testcontainers Postgres and applies the migration once at `beforeAll`).
- **Isolation from Task 4's block:** confirmed the new block has its own `TestDb`
  container, its own `RoomService`, and its own `beforeAll`/`afterAll` — no shared
  mutable state between the two `describe` blocks (consistent with REQ-CORE-004).
- **Test title wording:** the `it()` title says "...the other conflicts" as a plain-English
  description of the losing branch, not a literal claim that the rejection is always
  `RoomConflictError` — the adjacent comment block spells out that either subclass is
  legitimate. Considered renaming to avoid any ambiguity but judged the comment
  sufficient; flagging here in case a reviewer prefers stricter wording.

## Issues or concerns

None. All gates green, no flakiness observed across 5 repeated runs of the race
test, diff is scoped to exactly the one file and matches the intended change.
