# Task 4 Report: ProjectionService

## Status: DONE

Commit: `bf1f43290a766db6ba7539795b2bbabd377d9a96` on `feat/realtime-read-handshake`

## Per-step actions

### Pre-checks
- Branch confirmed: `feat/realtime-read-handshake`, clean tree (only untracked `AGENTS.md`).
- SDK 1.2.0 present; `appSettingsVisibilityMap`, `projectedEventSchema`, types `AppManifest`, `ProjectedEvent`, `Visibility` exist in `packages/sdk/src/`. Ran `pnpm --filter @mymozhem/sdk build` to refresh `dist/` (initially looked stale); verified re-exports in `dist/index.js`/`dist/index.d.ts`.

### Step 1: Failing test
- Created `packages/core/src/realtime/projection.service.spec.ts` verbatim from the brief (7 test cases).

### Step 2: Verify red
- Command: `pnpm --filter @mymozhem/core test projection.service`
- Result: 1 test suite matched and failed to run — `TS2307: Cannot find module './projection.service'` (expected red; secondary TS7006 about implicit `any` parameter disappears once the service exists). 0 tests executed — expected, since the suite cannot compile without the module.

### Step 3: Implementation
- Created `packages/core/src/realtime/projection.service.ts` verbatim from the brief: `OutwardLevel`, `VISIBLE_TO` / `SETTINGS_VISIBLE_TO` maps, `@Injectable()` `ProjectionService` with `projectEvent` (projectedEventSchema.parse, strictObject — loud rejection), `projectEvents`, `projectAppSettings` (fail-safe: unannotated and out-of-schema properties → module-private; undefined manifest / non-object settings → {}).

### Step 4: Verify green
- Command: `pnpm --filter @mymozhem/core test projection.service`
- Result: PASS — 1 suite, **7 passed, 7 total** (>0 matched at both red and green).

### Step 5: Commit
- `git add` exactly the two named files; commit message exactly as in brief plus `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer. 2 files changed, 145 insertions.

## Deviations
- None from the brief's code (test and implementation copied verbatim). Only extra action: SDK rebuild before starting, which the parent context authorized.

## Global constraints check
- module-private never projected outward: `VISIBLE_TO` contains no `MODULE_PRIVATE`; `?? 'module-private'` fallback for unannotated/out-of-schema settings keys.
- `projectedEventSchema.parse` on every projected event (via `projectEvent` inside `projectEvents`).
- Only the two brief-named files created/committed.
- Test summary: 7 passed, 7 total.
