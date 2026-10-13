# Task 7 report: actorId в lifecycle-эмит через transition (REQ-RT-009, service-уровень)

**Status:** DONE
**Commit:** `57b32ec` — `feat(core): actorId в lifecycle-эмит через transition (REQ-RT-009, service-уровень)`
**Branch:** phase-1-event-commit
**Date:** 2026-08-05

## What was done

Threaded `actorId` through `RoomService.transition` into both lifecycle `commitCoreEvent` call sites, per the brief verbatim.

### Files changed (exactly the two permitted)

1. `packages/core/src/room/room.service.ts`
   - `transition(roomId, to, actorId: string | null = null)` — new 3rd parameter with the REQ-RT-009 comment from the brief.
   - Both `commitCoreEvent` call sites inside `transition` now pass `actorId` as the 5th argument: the `'room.activated'` branch and the `LIFECYCLE_EVENTS[to]` branch.
   - Wrappers `activate` / `complete` / `cancel` accept `actorId: string | null = null` and forward it.

2. `packages/core/src/realtime/event-log.int-spec.ts`
   - Added the test verbatim from the brief: `records actorId on lifecycle events when the caller supplies it (REQ-RT-009)` — seeds identity `00000000-0000-0000-0000-0000000000c3`, creates a room, `rooms.cancel(room.id, ACTOR)`, asserts the single log row is `core.room.cancelled` with `actorId: ACTOR`.

## TDD trail

- **Red (Step 2):** `pnpm --filter @mymozhem/core test:int -t "records actorId on lifecycle"` → FAIL with `TS2554: Expected 1 arguments, but got 2` at `rooms.cancel(room.id, ACTOR)` — exactly the failure mode predicted by the brief.
- **Green (Step 4):** same command → PASS. Filter matched exactly **1 test** (1 passed, 100 skipped).

## Verification results

| Command | Result |
|---|---|
| `pnpm --filter @mymozhem/core test:int -t "records actorId on lifecycle"` | PASS — 1 test |
| `pnpm --filter @mymozhem/core test:int` (full suite) | PASS — 11 suites, 101 tests |
| `pnpm build` (before server tests, per staleness constraint) | 3/3 tasks successful |
| `pnpm --filter @mymozhem/server test` | PASS — 2 suites, 15 tests |

Docker/testcontainers available and used; no BLOCKED condition.

## Backward compatibility

- `actorId` defaults to `null` everywhere; signature change is purely additive.
- Grepped all callers of `.transition/.activate/.complete/.cancel` across `packages/` and `apps/` — every existing call site uses the single-argument form (room.service.int-spec.ts, token.service.int-spec.ts, event-commit.int-spec.ts, transport.e2e-spec.ts). All suites pass unchanged.
- Existing test in event-log.int-spec.ts asserting `actorId: null` for direct `commitCoreEvent` calls still passes (the default path).

## Concerns

None.
