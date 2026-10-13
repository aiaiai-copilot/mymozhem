# Task 3 Report: RoomService.transition в транзакцию + lifecycle-эмит (REQ-RT-010, REQ-DEV-008)

## What was implemented

- `RoomService` constructor extended to `(prisma: PrismaService, eventLog: EventLogService)`; public signatures of `create/transition/activate/complete/cancel/softDelete` unchanged.
- `transition` rewritten as a single `$transaction`: SELECT → not-found/deleted check → `assertTransition` → guarded `updateMany` (WHERE on id+status+deletedAt) → on `count === 0` throw `RoomConflictError` (rollback) → lookup in `LIFECYCLE_EVENTS` → `eventLog.commitCoreEvent(tx, roomId, eventName, {})` → re-read via `findUniqueOrThrow`. A throw anywhere rolls back both the status change and the event (fail-closed, REQ-DEV-008).
- `LIFECYCLE_EVENTS: Partial<Record<RoomStatus, CoreEventName>>` contains exactly `COMPLETED: 'room.completed'` and `CANCELLED: 'room.cancelled'` — no `ACTIVE` (activation deliberately does not emit; its payload is the REQ-RT-004 pin from the future appSettings slice, design §0 п.1).
- `room.module.ts` now imports `RealtimeModule` (exports `EventLogService`) alongside `PrismaModule`.
- New describe block `RoomService lifecycle log emit (REQ-RT-010)` with 4 tests: complete emits exactly one public event (seq=1, contract shape); cancel from DRAFT and from ACTIVE; nothing emitted on illegal/terminal transitions, create, or softDelete; two competing cancels → exactly one event from the winner, room ends CANCELLED.

## What was tested and results

- `pnpm --filter @mymozhem/core test:int -- room.service.int-spec` — 18/18 passed (14 old + 4 new).
- `pnpm --filter @mymozhem/core test:int` — 5 suites, 33/33 passed (matches brief expectation: 25 + 4 emit + 4 primitive).
- `pnpm --filter @mymozhem/core test` — 5 suites, 55/55 passed.
- `pnpm --filter @mymozhem/core typecheck` — clean (`tsc --noEmit`).
- `pnpm --filter @mymozhem/core lint` — clean (`eslint src`).

## TDD Evidence

### RED

Per the brief's chicken-and-egg resolution: call-sites updated, new describe added, step-4 implementation applied with the `commitCoreEvent` line temporarily commented (file compiles, no emission).

Command: `pnpm --filter @mymozhem/core test:int -- room.service.int-spec`

Result: `Tests: 4 failed, 14 passed, 18 total`. All 4 new emit tests failed on missing emission, e.g.:

```
● RoomService lifecycle log emit (REQ-RT-010) › two competing cancels emit exactly one event...
  expect(received).toHaveLength(expected)
  Expected length: 1
  Received length: 0
  Received array:  []
```

and `cancel() from DRAFT and from ACTIVE`: `expected ['core.room.cancelled'], received []`. Expected because the emit line was commented out; the 14 pre-existing tests passed, confirming the transactional rewrite itself changed no observable behavior.

### GREEN

Emit line uncommented, `room.module.ts` updated.

Command: `pnpm --filter @mymozhem/core test:int -- room.service.int-spec`

Result:

```
Tests:       18 passed, 18 total
```

Then full lane: `Tests: 33 passed, 33 total`; unit `55 passed`; typecheck and lint clean.

## Files changed

- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/room/room.service.ts` — imports (`CoreEventName`, `EventLogService`), `LIFECYCLE_EVENTS` table, new constructor, transactional `transition` with emit.
- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/room/room.module.ts` — imports `RealtimeModule`.
- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/room/room.service.int-spec.ts` — 2 new imports, 3 constructor call-sites updated, new describe (4 tests) appended.
- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/realtime/event-log.int-spec.ts` — 1-line fix: `new RoomService(db.prisma)` → `new RoomService(db.prisma, new EventLogService())`.

## Self-review findings, issues, concerns

- **Deviation from brief (required fix):** the brief mentioned three constructor call-sites in `room.service.int-spec.ts`, but the full int lane exposed a fourth call-site in `packages/core/src/realtime/event-log.int-spec.ts` (Task 2's spec, uses `RoomService.create` only as a room fixture). Updated it to pass `new EventLogService()`; `create` does not emit, so the spec's assertions are unaffected. Covered by the commit's `git add packages/core/src/realtime` path.
- RED was genuinely observed for all 4 new tests (empty log vs expected events).
- `LIFECYCLE_EVENTS` verified to contain exactly COMPLETED/CANCELLED; `softDelete` and `create` untouched (no emission paths added there).
- No concerns remaining.
