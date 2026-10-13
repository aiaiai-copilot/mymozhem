# Task 4 Report: Guarded INSERT in RoomService.create + ROOM_ORGANIZER_NOT_REGISTERED

**Status:** DONE
**Commit:** `8086a54` — `feat(core): enforce REGISTERED organizer via atomic guarded INSERT (REQ-ID-005)`
**Branch:** `phase-1-identity-seam`

## What was implemented

1. `packages/core/src/room/room.errors.ts` — added `ROOM_ORGANIZER_NOT_REGISTERED` to `ROOM_ERROR_CODES` and the `RoomOrganizerNotRegisteredError extends RoomError` class (verbatim from brief, with the collapsed-code rationale comment).
2. `packages/core/src/room/room.service.int-spec.ts` — three guard tests inside the `RoomService lifecycle` describe, right after `'create() yields a DRAFT room'`: GUEST organizer rejected (with code assertion), nonexistent organizer rejected with the same collapsed code, anonymized (`deletedAt` set) REGISTERED organizer rejected. Import extended with `RoomOrganizerNotRegisteredError`.
3. `packages/core/src/room/room.service.ts` — `create()` rewritten from `prisma.room.create` to a single atomic `INSERT … SELECT … WHERE EXISTS` via `$queryRaw<Room[]>`; zero rows returned ⇒ throw `RoomOrganizerNotRegisteredError`. Comment block documents REQ-ID-005, the no-check-before-write philosophy, race-safety argument, and the dual-location predicate note (index condition in the Task 2 migration).

All code verbatim from the brief. No other files touched; no schema change; no new dependencies.

## What was tested and results

- RED: `pnpm --filter @mymozhem/core run test:int -- room.service` — exactly the 3 new tests failed, 11 pre-existing passed.
- GREEN: same command — 14/14 passed.
- Full package gates: typecheck PASS; unit 55/55 (5 suites); integration 21/21 (3 suites, incl. identity-schema and harness specs); lint clean.
- Repo-level gates: `boundary-check` — 0 violations (170 modules, 344 deps); `guardrails` — all 3 guardrails alive; `@mymozhem/sdk` tests — 162/162 (12 suites).

## TDD evidence

### RED

Command: `pnpm --filter @mymozhem/core run test:int -- room.service`

Result: `Tests: 3 failed, 11 passed, 14 total`. The three failures, all expected because `create` still inserted blindly:

1. GUEST organizer: `Expected constructor: RoomOrganizerNotRegisteredError / Received constructor: Object` — `create` resolved with a room instead of rejecting.
2. Nonexistent organizer: `Received constructor: PrismaClientKnownRequestError` — the raw FK violation surfaced instead of the collapsed typed error.
3. Anonymized organizer: `Received promise resolved instead of rejected` — `create` inserted a DRAFT room for a soft-deleted identity.

### GREEN

Command: `pnpm --filter @mymozhem/core run test:int -- room.service`

Result: `Tests: 14 passed, 14 total`, including:
- `✓ rejects a GUEST organizer with ROOM_ORGANIZER_NOT_REGISTERED (REQ-ID-005)`
- `✓ rejects a nonexistent organizer with the same collapsed code`
- `✓ rejects an anonymized (deletedAt) REGISTERED organizer`
- All pre-existing lifecycle / atomicity / CHECK / FK tests still green.

## Files changed (commit 8086a54, 56 insertions, 5 deletions)

- `packages/core/src/room/room.errors.ts`
- `packages/core/src/room/room.service.ts`
- `packages/core/src/room/room.service.int-spec.ts`

## Self-review findings

- **Completeness:** every brief step executed in order; commit message verbatim; only brief-listed files touched. The `harness.int-spec.ts` and other describes were left alone as instructed.
- **Quality:** raw SQL is parameterized (`${organizerId}::uuid`), no injection surface; `RETURNING *` maps cleanly onto `Room` (verified by the existing `create() yields a DRAFT room` assertions passing unchanged); the typed error carries a stable `code`, never crossing a boundary (REQ-SEC-006 seam).
- **Discipline/YAGNI:** no helper extraction, no extra error variants, no defensive code beyond the brief. The GUEST/anonymized/nonexistent cases are intentionally collapsed into one code per design §3.
- **Testing hygiene:** RED was observed before GREEN with the three distinct expected failure modes; no test weakened to pass; `maxWorkers: 1` and jest config untouched; FROZEN migrations untouched.

## Issues / concerns

- Minor, out of scope: a malformed (non-UUID) `organizerId` now surfaces a raw Postgres `invalid input syntax for type uuid` error rather than `RoomOrganizerNotRegisteredError` — same class of leak as the old Prisma client error. No caller-facing boundary exists yet to map it; flagging for the future HTTP/socket layer, not for this slice.

## Post-review fix: fixture comment typo

- **What changed:** `packages/sdk/src/identity/identity-kind.fixtures.ts` line 5 — comment above `invalidKinds` said "Unknown roles…"; corrected "roles" → "kinds" (this is the identity-KIND fixture file). Comment-only change, no other files touched.
- **Verification command:** `pnpm --filter @mymozhem/sdk test -- identity-kind`
- **Test output summary:** PASS `src/identity/identity-kind.contract.spec.ts` — 1 suite, 9/9 tests passed (identityKind contract, REQ-ID-001).
- **Commit:** `c79c2428ea4b5071e83e2066c2c866de1fdf7b87` — `fix(sdk): correct fixture comment typo (REQ-ID-001)` on `phase-1-identity-seam`.
