# Task 3 Report: RoomService.configure — write path тройки (REQ-RT-004)

## Status: DONE

Commit: `e23b63e feat(core): RoomService.configure write path (REQ-RT-004)` on `phase-1-appsettings-write-path`.

## What was implemented

1. **room.errors.ts** — added `ROOM_NOT_CONFIGURED` / `ROOM_SETTINGS_FROZEN` to `ROOM_ERROR_CODES` and the `RoomNotConfiguredError` / `RoomSettingsFrozenError` classes verbatim from the brief. `RoomNotConfiguredError` is intentionally unused here — it is the Task 4 interface contract (activation gate); `RoomSettingsFrozenError` is used by `configure`.
2. **room.service.ts** — constructor is now three-argument `(prisma, eventLog, appRegistry)`; new `configure(roomId, { appId, manifestVersion, settings })` between `create` and `transition`: validates via `AppRegistryService.validateSettings` BEFORE any DB access (REQ-CORE-007), then a single guarded `updateMany` (`status: 'DRAFT', deletedAt: null`) atomically replacing the whole triple; `count === 0` re-reads only for a precise server-side message and throws `RoomSettingsFrozenError` with the single collapsed code (design §6). `Prisma.InputJsonValue` cast with the brief's comment.
3. **room.module.ts** — imports `AppRegistryModule` so Nest DI resolves the third constructor arg.
4. **room.service.int-spec.ts** — new imports (`validManifests`, `AppRegistryService`, both app-registry error classes, expanded room.errors import); `QUIZ_SETTINGS` / `makeService(db)` / `configureQuiz` helpers; all 5 `new RoomService(db.prisma, new EventLogService())` call-sites replaced with `makeService(db)`; new `describe('RoomService.configure (REQ-RT-004)')` appended verbatim from the brief.
5. **realtime/event-log.int-spec.ts** (beyond the brief's file list, per the launcher note to grep the whole `packages/core/src`) — the 6th `new RoomService(` call-site; updated to three args with `new AppRegistryService([validManifests[0]])`. Committed together with the room changes since the constructor change is atomic — leaving it out would have broken compile at this commit.

## Test results

- Focused configure tests: **8/8 PASS** (5 single + 3 `it.each` cases).
- Full unit suite: **62/62 PASS** (5 suites).
- Full integration suite: **45/45 PASS** (5 suites, including event-log.int-spec) — activation semantics untouched at this head, as required.
- `pnpm --filter @mymozhem/core lint` — clean.
- `pnpm --filter @mymozhem/core typecheck` — clean.
- `pnpm boundary-check` (repo root depcruise) — no violations (194 modules).

## TDD Evidence

### RED

Command: `pnpm --filter @mymozhem/core test:int -t "configure"` (without `--`; the brief's `-- -t` form misparsses `-t` into a testPathPattern — known Jest CLI nuance from Task 1).

Output (excerpt):
```
src/room/room.service.int-spec.ts:414:8 - error TS2339: Property 'configure' does not exist on type 'RoomService'.
src/room/room.service.int-spec.ts:426:8 - error TS2339: Property 'configure' does not exist on type 'RoomService'.
src/room/room.service.int-spec.ts:452:15 - error TS2339: Property 'configure' does not exist on type 'RoomService'.
src/realtime/event-log.int-spec.ts:22:7 - error TS2554: Expected 2 arguments, but got 3.
Test Suites: 2 failed, 3 skipped
```

Expected: tests written against the new `configure` method and the 3-arg constructor cannot compile until the implementation lands — this is exactly the brief's anticipated RED (`service.configure is not a function` at the type level).

### GREEN

Command: same, after implementing Step 5.

Output (excerpt):
```
PASS src/room/room.service.int-spec.ts
Test Suites: 4 skipped, 1 passed, 1 of 5 total
Tests:       37 skipped, 8 passed, 45 total
```

Followed by full gates (unit 62/62, full int 45/45, lint, typecheck, boundary-check) — all green.

## Files changed

- `packages/core/src/room/room.errors.ts`
- `packages/core/src/room/room.service.ts`
- `packages/core/src/room/room.module.ts`
- `packages/core/src/room/room.service.int-spec.ts`
- `packages/core/src/realtime/event-log.int-spec.ts`

## Self-review findings

- **Completeness**: all brief steps done verbatim; the one extension (event-log.int-spec.ts 6th call-site) was explicitly mandated by the launcher context and verified by grep — no other `new RoomService(` call-sites remain in `packages/core/src`.
- **Discipline**: no activation/transition changes (Task 4 territory); no SDK changes; no new directories; code values copied verbatim from the brief.
- **Quality**: guarded UPDATE follows the existing DB-invariant philosophy of the file; re-read on failure is message-only, single collapsed error code per design §6.
- **Deviations from brief (both instructed by launcher context)**: (a) jest invocation without `--`; (b) event-log.int-spec.ts included in the same commit rather than only `packages/core/src/room` paths — required for the commit to compile.

## Issues / concerns

None blocking. Note for Task 4: `activate()` on an unconfigured room currently still succeeds (no `RoomNotConfiguredError` gate yet) — that is by design at this task's head; the it.each ACTIVE case configures before activating, so it stays valid when Task 4 lands the gate.
