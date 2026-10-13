# Task 5 Report — TokenService.rotate (REQ-ID-007 / REQ-ID-016)

**Status:** DONE
**Commit:** `d71e1b2` — `feat(core): refresh rotation with reuse detection and REQ-ID-016 invalidation` (branch `phase-1-transport-http-auth`)

## What was done

- TDD: wrote `packages/core/src/auth/token.service.int-spec.ts` first; confirmed red with the expected TS error (`TS2339: Property 'rotate' does not exist on type 'TokenService'`).
- Implemented `TokenService.rotate(refreshToken)` in `packages/core/src/auth/token.service.ts` — the brief's code verbatim (unknown token → SESSION_INVALID; reuse of rotated token → revoke entire `familyId` → SESSION_INVALID; revoked/expired session → SESSION_INVALID; deleted identity, guest TTL, missing membership, terminal room → SESSION_INVALID; race handled by conditional `updateMany` inside a transaction, loser gets SESSION_INVALID without family revocation).
- Green: all 8 rotate tests pass; full core int lane and unit lane pass; typecheck + lint clean.

## Actual service signatures discovered

- `RoomService.create(organizerId: string, joinPolicy: RoomJoinPolicy = 'guests'): Promise<Room>` — creates DRAFT room + ORGANIZER membership in one transaction; organizer must be a live REGISTERED identity.
- `RoomService.activate(roomId)` — requires prior `configure` (appId/manifestVersion/appSettings), else `RoomNotConfiguredError`.
- `RoomService.complete(roomId)` — legal only from ACTIVE.
- `RoomService.cancel(roomId)` — legal from DRAFT and ACTIVE (state machine: `DRAFT → {ACTIVE, CANCELLED}`).
- `MembershipService.join({ code, displayName, ip }): Promise<JoinResult>` — returns `{ identity, membership }`.
- `seedIdentity(prisma, { id?, kind?, email?, deletedAt? })` — defaults to REGISTERED.
- Session model matches the brief: `refreshTokenHash @unique`, `familyId`, `replacedById?`, `revokedAt?`, `expiresAt`.

## Seeding choices vs the brief

- Terminal-room seed uses `roomService.cancel(room.id)` (DRAFT→CANCELLED), as the brief explicitly allowed: `activate` requires `configure`, and the rotate branch treats COMPLETED and CANCELLED identically. Test intent (terminal room → SESSION_INVALID) preserved; test renamed to "rejects refresh when the room is terminal (REQ-ID-016)".
- Guest+membership seeded per test via a `seedGuestWithRoom()` helper: `roomService.create(ORG)` → `membership.join(...)` → `tokens.issueGuestTokens(identity.id, room.id)`.
- Harness mirrors `membership.service.int-spec.ts` (manual construction, `startTestDb`, TRUNCATE in `afterEach`); TRUNCATE list extended with `identity."Session"` as instructed: `TRUNCATE TABLE identity."Session", membership."Membership", room."Room" CASCADE`.

## Deviations from the brief (with reasons)

1. **Race-test "alive" predicate.** The brief's verbatim race test asserted `session.count({ where: { revokedAt: null } }) === 1`, but the design-faithful implementation (design doc §4, line 112: conditional UPDATE sets only `replacedById`) leaves the rotated session with `revokedAt = null` — `revokedAt` is reserved for explicit/family revocation (design doc table, line 106). First green run therefore failed with `alive = 2`. Fixed the TEST (not the implementation): alive is now counted as `{ revokedAt: null, replacedById: null }` — i.e. "neither rotated nor revoked". Strengthened the intent with one extra assertion: the winner's new refresh token rotates successfully, proving the family was NOT revoked on race. Implementation remains the brief's code verbatim.
2. **First rotation test**: kept the brief's assertions and added `new Set(sessions.map(s => s.familyId)).size === 1` to pin "familyId preserved" explicitly (the brief named that intent in the test title but only asserted length 2).
3. Unknown-token and terminal-room tests also assert `err.code === 'SESSION_INVALID'` (not just `instanceof AuthError`) — same style as the membership int-spec's typed-error assertions.

No deviations in the implementation code itself.

## Invariant verification (self-review against the brief's list)

- Reuse of already-rotated token → `updateMany` revokes whole `familyId`, then SESSION_INVALID. Covered by test 2 (both old and new tokens dead, `revokedAt: null` count = 0). ✔
- Race → conditional `updateMany(id, replacedById: null, revokedAt: null, expiresAt > now)`; exactly one winner; loser SESSION_INVALID; family NOT revoked. Covered by the race test (1 fulfilled / 1 rejected, winner continues). ✔ Under READ COMMITTED the loser's `updateMany` blocks on the winner's row lock and re-evaluates the predicate post-commit → count 0 → `AuthError('rotation race lost')` inside the transaction → rollback.
- Guest `roomId` from the identity's single membership; REGISTERED branch skips room checks (`roomId` stays `undefined`). ✔
- New session `expiresAt` is sliding via the existing protected `sessionExpiry()` (`now + min(REFRESH_TOKEN_TTL, GUEST_TTL)`); guest ceiling additionally enforced by the TTL check on `identity.createdAt`. ✔
- All refusal branches surface a single `SESSION_INVALID` code; distinctions live only in server-side messages. ✔
- Prisma 7.8 adapter-pg traps: no `$queryRaw` void expressions used (only client calls + `$transaction`); no SQLSTATE/P2010 handling needed; migrations and schema.prisma untouched. ✔

## Test commands + output tails

1. `pnpm --filter @mymozhem/core test:int -t "TokenService.rotate"` (red, before implementation):
   `error TS2339: Property 'rotate' does not exist on type 'TokenService'` — expected.
2. Same command after implementation:
   `PASS src/auth/token.service.int-spec.ts — Tests: 8 passed, 80 skipped, 88 total`.
3. `pnpm --filter @mymozhem/core test:int` (full int lane):
   `Test Suites: 10 passed, 10 total / Tests: 88 passed, 88 total / Time: 47.253 s`.
4. `pnpm --filter @mymozhem/core test` (unit lane):
   `Test Suites: 8 passed, 8 total / Tests: 94 passed, 94 total`.
5. `pnpm --filter @mymozhem/core typecheck` and `lint` — clean, no output.

## Concerns

- None blocking. Note for reviewers: the rotated session keeps `revokedAt = null` by design (rotation ≠ revocation); any future sweep job or audit query must treat `replacedById != null` as "dead" too. This matches design doc §4 as written.
