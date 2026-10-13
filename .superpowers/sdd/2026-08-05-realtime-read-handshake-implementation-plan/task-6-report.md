# Task 6 report: SubscriptionRegistry + findActiveMembership + токен reconnect-лимитера

**Status:** DONE
**Commit:** 3f27ea6e3f7ad84bb47eba3ba8b92ec5f597f3fb (branch feat/realtime-read-handshake)

## Step 1 — failing unit test (реестр)
- Created `packages/core/src/realtime/subscription-registry.spec.ts` verbatim from the brief (4 tests).

## Step 2 — verify red
- `pnpm --filter @mymozhem/core test subscription-registry` → FAIL: TS2307 Cannot find module './subscription-registry'. Suite matched (1 suite), 0 tests ran — expected red.

## Step 3 — implementation
- Created `packages/core/src/realtime/subscription-registry.ts` verbatim from the brief (`Subscription` interface, `SubscriptionRegistry` with bySocket + socketsByMembership indexes changed only together; state only in instance fields — REQ-CORE-004).
- Created `packages/core/src/realtime/realtime.tokens.ts` verbatim (`RECONNECT_RATE_LIMITER` Symbol, REQ-RT-015).
- Pre-checks: `OutwardLevel` confirmed exported from `projection.service.ts` (line 13).

## Step 4 — verify green
- `pnpm --filter @mymozhem/core test subscription-registry` → PASS, 4/4 tests.

## Step 5 — failing int-test (findActiveMembership)
- Visited `packages/core/src/membership/membership.service.int-spec.ts` first (per brief). Alignments vs the brief's sketch:
  - `rooms` → `roomService` (actual variable in file).
  - `membership` → `makeMembership()` (file's factory helper; used inline in the new tests).
  - `P1` did not exist — added `const P1 = '00000000-0000-0000-0000-000000000002'` and seeded it in `beforeAll` via `seedIdentity(db.prisma, { id: P1, email: 'p1@example.test' })` (same pattern as ORG).
  - New `describe('findActiveMembership')` inserted inside the existing top-level describe (shares db/beforeAll), after the last `it`.
- Pre-checks: Prisma `Membership` has `@@unique([roomId, identityId])` → compound where key `roomId_identityId` valid; `RoomService.softDelete(roomId)` exists.

## Step 6 — red → implement → green
- `pnpm --filter @mymozhem/core test:int membership.service -t "findActiveMembership"` → FAIL (red): TS2339 Property 'findActiveMembership' does not exist (3 sites). Suite matched.
- Added `findActiveMembership` to `packages/core/src/membership/membership.service.ts` immediately after `createOrganizerMembership`, verbatim from the brief (comment notes soft-delete of membership arrives with the exclusion slice; returns null for non-member and soft-deleted room — REQ-SEC-003).
- `... -t "findActiveMembership"` → PASS: 3 passed, 15 skipped (filter works, >0 matched).
- `pnpm --filter @mymozhem/core test:int membership.service` (full file) → PASS: 18/18 tests.

## Step 7 — commit
- Added exactly the 5 files named in the brief; commit message verbatim + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer. 5 files changed, 133 insertions(+).

## Deviations
- Only the variable-name alignments sanctioned by the brief (`rooms`→`roomService`, `membership`→`makeMembership()`, new seeded `P1` constant). All implementation code verbatim.

## Concerns
- None.
