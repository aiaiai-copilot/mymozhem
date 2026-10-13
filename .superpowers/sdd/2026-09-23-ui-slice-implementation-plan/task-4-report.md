# Task 4 Report: MembershipService — assertMember/assertOrganizer/listRoster

## What was implemented

Three membership-domain methods added to `MembershipService` (`packages/core/src/membership/membership.service.ts`), exactly per the brief's Step 3:

- `assertMember(roomId, identityId): Promise<Membership>` — delegates to `findActiveMembership`, throws `ActorNotMemberError` when no live membership.
- `assertOrganizer(roomId, identityId): Promise<Membership>` — on top of `assertMember`, throws `ActorNotOrganizerError` when role is not `ORGANIZER`.
- `listRoster(roomId): Promise<{ identityId; displayName: string | null; role: MemberRole }[]>` — active memberships in a live room (soft-deleted membership/room excluded), displayName taken from identity (null for swept guests — identity is NOT filtered, unlike `listActiveParticipantPool`).

`MemberRole` added to the existing `@prisma/client` type import. Russian why-comments verbatim from the brief (decisions №9/№10).

## What was tested and results

Tests added as a new describe block `assertMember / assertOrganizer / listRoster (UI-срез)` inside the existing first describe of `packages/core/src/membership/membership.service.int-spec.ts` (same seeding patterns as `findActiveMembership` / `listActiveParticipantPool`):

1. `assertMember` throws `ActorNotMemberError` for a non-member (P1), returns the membership for a joined guest.
2. `assertOrganizer` throws `ActorNotOrganizerError` for a PARTICIPANT, passes for ORG (ORGANIZER).
3. `listRoster` with organizer + live guest + swept guest (`identity.deletedAt` set, `displayName` nulled) + excluded member (`membership.deletedAt` set): roster has exactly 3 entries — ORG with `displayName: null` (seeded REGISTERED identity has no display name), alive guest with `'Живой'`, swept guest with `null`; excluded member absent.

All tests run against the real Postgres testcontainer — no mocks.

## TDD Evidence

### RED

Command: `pnpm --filter @mymozhem/core test:int membership.service.int-spec`

Output (before implementation):

```
FAIL src/membership/membership.service.int-spec.ts
  ● Test suite failed to run
    src/membership/membership.service.int-spec.ts:311:28 - error TS2339: Property 'assertMember' does not exist on type 'MembershipService'.
    src/membership/membership.service.int-spec.ts:322:17 - error TS2339: Property 'assertOrganizer' does not exist on type 'MembershipService'.
    src/membership/membership.service.int-spec.ts:345:36 - error TS2339: Property 'listRoster' does not exist on type 'MembershipService'.
Test Suites: 1 failed, 1 total
```

Expected failure: the three methods did not exist yet; ts-jest fails the suite at compile time with TS2339 — a genuine red (tests exercise methods that aren't there).

### GREEN

Command: `pnpm --filter @mymozhem/core test:int membership.service.int-spec`

```
assertMember / assertOrganizer / listRoster (UI-срез)
  ✓ assertMember throws ActorNotMemberError for non-member, returns membership for member (9 ms)
  ✓ assertOrganizer throws ActorNotOrganizerError for PARTICIPANT, passes for ORGANIZER (10 ms)
  ✓ listRoster returns active members with identity displayName (null after sweep) (17 ms)
Test Suites: 1 passed, 1 total
Tests:       40 passed, 40 total
```

Full core int suite: `pnpm --filter @mymozhem/core test:int` → `Test Suites: 20 passed, 20 total / Tests: 192 passed, 192 total` (100.8s).

Lint: `pnpm --filter @mymozhem/core lint` → clean (no findings).

## Files changed

- `packages/core/src/membership/membership.service.ts` — 3 methods + `MemberRole` type import.
- `packages/core/src/membership/membership.service.int-spec.ts` — new describe block with 3 tests.

## Self-review findings

None. Checked: all three methods present and verbatim to the brief; all required test cases incl. swept-guest `displayName: null` present in roster and excluded member absent; Russian why-comments match repo style; no overbuilding (no extra filters, no extra methods); tests hit the real DB; test output pristine; lint clean.

## Issues or concerns

None. Note for Task 5: `listRoster` deliberately does NOT filter by `identity.deletedAt` (swept guests stay in the roster with `displayName: null`), in contrast to `listActiveParticipantPool` — this is decision №10 as specified in the brief.
