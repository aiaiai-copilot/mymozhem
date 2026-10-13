# Final fix report — event-commit slice (whole-branch review "With fixes")

Date: 2026-08-05. Branch: `phase-1-event-commit` (base head 64d2447).
Scope: exactly the two Important findings + one Minor from the final whole-branch review. Nothing else touched.

## Fix 1 (Important): post-lock status re-check — TOCTOU, REQ-RT-016

**File:** `packages/core/src/realtime/event-log.service.ts`

- `appendLocked` gained a trailing optional parameter `recheckRoomActive = false`.
  When set, immediately after `pg_advisory_xact_lock` is acquired the room's status
  is re-read (`tx.room.findUnique`, `select: { status: true }`); anything other than
  `ACTIVE` throws `RoomNotActiveError` before the INSERT, so the tx rolls back and the
  sealed log gains nothing.
- `commitAppEvent` passes `true`; `commitCoreEvent` is untouched — byte-identical
  behavior (it emits the transitions *out of* ACTIVE and already holds the room
  row-lock via the guarded `updateMany`; a status check there would be wrong).
- Comment in code cites REQ-RT-016, the TOCTOU rationale, and records the sanctioned
  deviation from design §2's letter («все проверки ДО lock»): the re-check is
  payload-independent O(1), so the REQ-RT-007 neutrality contract (size-dependent
  validation strictly before the lock) is preserved. Owner decision.

**Race scenario closed:** emit reads ACTIVE at the pre-lock gate → concurrent cancel
commits (status row written before the advisory lock per the lock-ordering
convention) → emit acquires the released lock and, without the re-check, would append
an app event after the terminal transition. Now it rejects with `ROOM_NOT_ACTIVE`.

## Fix 2 (Important): safe stringify — typed error on unstringifiable payload

**File:** `packages/core/src/realtime/event-log.service.ts`

- New module-level helper `stringifyAppPayload(payload, eventType)`: on
  `JSON.stringify` throw (circular, BigInt) or `undefined` result (undefined,
  functions, symbols) throws `EventPayloadInvalidError` ("payload of X is not
  JSON-serializable") instead of leaking a raw `TypeError` outside the typed
  taxonomy (design §6).
- Step 3 (size, REQ-RT-012) uses the helper's return value for `Buffer.byteLength`.
  Step order unchanged: size still precedes registry/schema. `appendLocked` and the
  core path unchanged.

## Fix 3 (Minor): payload round-trip in the mixed-size race test

**File:** `packages/core/src/realtime/event-commit.int-spec.ts`, concurrency describe

- The payload-neutrality test now asserts each committed event carries its payload
  intact: the big event's `payload` deep-equals the 8000-char blob object (both on
  the returned events per round and on the storage rows after all rounds;
  `ROUNDS` big events each with `blob.length === 8000`). A corrupted-under-race
  write now fails the test instead of passing on dense seqs alone.

## Tests added

1. `rejects an emit that loses the race to a terminal transition (TOCTOU, REQ-RT-016)`
   (concurrency describe): raw tx holds `pg_advisory_xact_lock(hashtextextended(roomId, 0))`
   open on a deferred; `commitAppEvent` passes the status gate while ACTIVE and blocks
   on the lock; the test waits deterministically for the waiter to appear in
   `pg_locks` (`locktype='advisory' AND NOT granted`, condition-poll via
   `setImmediate`, bounded with a hard error after 1000 iterations — no sleeps);
   status is then flipped to `CANCELLED` by direct SQL in a separate transaction
   (deliberately without the advisory lock and without a log event — simulating the
   terminal transition's committed status); the held lock is released. Expected and
   observed: emit rejects with `RoomNotActiveError` (code `ROOM_NOT_ACTIVE`), log
   stays at length 1 (only `core.room.activated`).
2. `rejects an undefined payload with the typed error (EVENT_PAYLOAD_INVALID)` —
   asserts `EventPayloadInvalidError`, code, and nothing written.
3. `rejects a circular payload with the typed error (EVENT_PAYLOAD_INVALID)` — same.

## Fails-without-fix evidence (race test)

Guard temporarily disabled (`true` → `false` at the `appendLocked` call site in
`commitAppEvent`), ran only the new race test:

```
expect(received).toBeInstanceOf(expected)
Expected constructor: RoomNotActiveError
Received constructor: Object
> 508 |     expect(err).toBeInstanceOf(RoomNotActiveError);
Tests: 1 failed, 105 skipped, 106 total
```

i.e. without the re-check the emit commits successfully after the terminal
transition — the bug reproduces deterministically. Guard restored, suite re-run green.

## Verification (all local, throwaway testcontainers — no shared/prod targets)

- `pnpm --filter @mymozhem/core test:int -t "concurrency"` — 3 passed, **run 3x,
  no flakes** (3/3: "Tests: 103 skipped, 3 passed, 106 total").
- `pnpm --filter @mymozhem/core test` — 10 suites, 117 passed.
- `pnpm --filter @mymozhem/core test:int` — 11 suites, 106 passed.
- `pnpm lint` — 3/3 successful. `pnpm typecheck` — 5/5 successful. `pnpm build` — 3/3 successful.
- Docker available (testcontainers ran fine).

## Touched files

- `packages/core/src/realtime/event-log.service.ts`
- `packages/core/src/realtime/event-commit.int-spec.ts`
