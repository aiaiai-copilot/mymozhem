# Task 4 Report: Активация — предусловие, перевалидация, эмит room.activated

**Status:** DONE
**Commit:** `b89dfcc` feat(core): activation freeze + room.activated emit (REQ-RT-004, REQ-RT-010, REQ-CORE-007, REQ-DEV-008)

## What I implemented

1. **Test updates under the new activation contract (brief Step 1)** — in `room.service.int-spec.ts`:
   - 1а: `persists each legal transition` — `configureQuiz` before each `activate` (rooms a and c).
   - 1б: `soft-deletes in DRAFT/COMPLETED/CANCELLED, refuses in ACTIVE` — `configureQuiz` before `activate(active.id)`.
   - 1в: CHECK-constraint test `rejects an UPDATE that sets deletedAt on an ACTIVE room…` — `configureQuiz` before `activate`.
   - 1г: log-emit describe — three tests replaced verbatim with the brief's new versions (full-path anchor now expects 2 rows: `core.room.activated` with pin payload `{ appId: 'quiz', manifestVersion: 1 }` then `core.room.completed`; cancel-from-ACTIVE expects `[activated, cancelled]`; "emits nothing" anchor now expects 2 rows after the full path). The fourth test (`two competing cancels…`) untouched.
   - Verified by grep that every `.activate(` call site in the int-spec is covered: the remaining ones (lines ~95/100/124) expect rejections that fire before the config gate (terminal status / missing room / soft-deleted room), and the configure-describe ACTIVE setup already configures first.
2. **New failing tests (brief Step 2)** — appended `describe('RoomService activation gate (REQ-RT-004, REQ-CORE-007)')` verbatim: unconfigured-room rejection (DRAFT + empty log), tampered-settings revalidation rollback, absent-manifest rejection via empty registry, and the configure-vs-activate race test (two allowed outcomes, not narrowed). Added `RoomNotConfiguredError` to the `./room.errors` import.
3. **Transition rewrite (brief Step 4)** — in `room.service.ts`, verbatim:
   - Error import extended with `RoomNotConfiguredError`; `LIFECYCLE_EVENTS` comment updated (activated is now a special branch).
   - `transition` rewritten: guarded `updateMany` (row-lock = serialization point with configure) → **post-lock re-read** → for `ACTIVE`: config-triple precondition (`RoomNotConfiguredError`) → `appRegistry.validateSettings` revalidation (REQ-CORE-007) → `commitCoreEvent(tx, roomId, 'room.activated', { appId, manifestVersion })` as the last transactional step (advisory lock leaf-most convention). Non-ACTIVE branch unchanged semantically (LIFECYCLE_EVENTS lookup, empty payload). Returns the post-lock row.
   - Verified the SDK `CORE_EVENTS['room.activated']` schema is `strictObject({ appId: appIdSchema, manifestVersion: int positive })`, public, version 1 — matches the emitted payload and the test anchors.

## Test results

- Full integration suite: **49/49 passed, 0 skipped, 5/5 suites** (`pnpm --filter @mymozhem/core test:int`, ~29s).
- Targeted re-run of the race-sensitive describe (`-t "activation gate"`): 4/4 passed.
- `tsc --noEmit` clean; `eslint src` clean.

## TDD evidence

**RED** — after test edits, before the transition rewrite:

- `pnpm --filter @mymozhem/core test:int -t "activation gate"` (note: brief Step 3's command had a `--` separator; per the known jest CLI nuance I ran it without `--`, otherwise jest misparses `-t`):
  - 4 failed / 45 skipped. Failures exactly as predicted: `RoomNotConfiguredError`/`AppSettingsInvalidError`/`AppManifestUnknownError` expected but activation succeeded (received plain Object = the activated room), and the race test saw an empty log (`Expected length: 1, Received length: 0`) because activation did not emit.
- `pnpm --filter @mymozhem/core test:int -t "lifecycle log emit"`:
  - 3 failed / 1 passed — the updated anchors expect 2 rows (activated + completed/cancelled), implementation still emitted only the terminal event (`Expected length: 2, Received length: 1`).

**GREEN** — after the Step 4 rewrite:

- `pnpm --filter @mymozhem/core test:int` → `Test Suites: 5 passed, 5 total / Tests: 49 passed, 49 total / Snapshots: 0 total`.
- `pnpm --filter @mymozhem/core test:int -t "activation gate"` → `Tests: 45 skipped, 4 passed, 49 total`.

## Files changed

- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/room/room.service.ts` (+49/−14 net across both files: transition rewrite, import, comment)
- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/room/room.service.int-spec.ts` (Step 1 updates + Step 2 new describe + import)

## Self-review findings

- **Completeness:** all six brief steps executed; transition code and all test blocks match the brief verbatim. Grep confirmed no `.activate(` call site missed.
- **Correctness of the pivotal semantics:** activation order is guarded UPDATE → post-lock re-read → precondition → revalidation → emit. The pin emitted into `core.room.activated` is read from the post-lock row, so under a configure race the event payload always matches the frozen row (asserted by the race test in both allowed outcomes). Emit stays last in the transaction, preserving the leaf-most advisory-lock convention (no `room."Room"` write after `commitCoreEvent`).
- **Emit safety:** the emitted `appId` reaches `commitCoreEvent`'s zod validation only after `validateSettings` succeeded for that exact triple, so a tampered/unknown pin can never produce an event that fails schema validation mid-transaction — revalidation throws first and rolls everything back (covered by tests 2 and 3 of the new describe).
- **Discipline:** no scope creep, no signature changes, commit message exactly as brief Step 6, only `packages/core/src/room` staged; working tree clean after commit.
- **Testing:** RED confirmed on both the new gate tests and the updated regression anchors before any implementation change; full suite (not just targeted) green afterwards; race test re-run for flake confidence. Race test left intentionally two-outcome per the brief — scheduling is unobservable.

## Issues / concerns

None. One process note: the brief's Step 3 command includes a `--` separator (`test:int -- -t …`) which makes jest misparse `-t`; I used the corrected form from the task context. If the brief is reused, that line should be fixed.
