# Task 2 report — SDK: код `ACTOR_NOT_MEMBER`, wire-схемы realtime, версия 1.2.0

**Status:** DONE
**Commit:** `23cfa4d7582c2b83fe22e8b510d37a48bbe9b9ca`
**Branch:** `feat/realtime-read-handshake`

## Per-step actions

### Step 1 — failing contract tests
Created verbatim from the brief:
- `packages/sdk/src/realtime/realtime-messages.fixtures.ts`
- `packages/sdk/src/realtime/realtime-messages.contract.spec.ts`

Pre-checks: confirmed consumed schemas exist (`src/events/event-type.ts`, `src/events/projected-event.schema.ts`, `src/visibility/visibility.ts`, `contractErrorPayloadSchema` in `src/errors/error-codes.ts`); confirmed branch `feat/realtime-read-handshake` checked out.

### Step 2 — red verification
Command: `pnpm --filter @mymozhem/sdk test realtime-messages` (no `--`, as instructed).
Output: `Test Suites: 1 failed, 1 total; Tests: 0 total` — suite matched (>0) and failed to compile with `TS2307: Cannot find module './realtime-messages'`. Red confirmed exactly as expected.

### Step 3 — implementation
- Created `packages/sdk/src/realtime/realtime-messages.ts` verbatim from the brief (`REALTIME_MESSAGES`, `subscribeRequestSchema`, `roomSnapshotSchema`, `subscribeOkAckSchema`, `publishRequestSchema`, `publishOkAckSchema` + inferred types).
- `packages/sdk/src/errors/error-codes.ts`: inserted `'ACTOR_NOT_MEMBER',` right after `'ROOM_SETTINGS_FROZEN',`, before the transport-facing comment.
- `packages/sdk/src/index.ts`: added `export * from './realtime/realtime-messages';` after the `token-response` line.
- `packages/sdk/src/contract-version.ts`: `CONTRACT_VERSION = '1.2.0'` (comment block untouched).
- `packages/sdk/package.json`: `"version": "1.2.0"`.

### Step 4 — green + build
1. `pnpm --filter @mymozhem/sdk test realtime-messages` → 12/12 passed (1 suite).
2. `pnpm --filter @mymozhem/sdk test` (full) → **1 failure** in pre-existing `src/errors/error-codes.contract.spec.ts`: the spec `exports exactly the codes named by the design §8` hard-codes the full `CONTRACT_ERROR_CODES` list and did not contain `ACTOR_NOT_MEMBER`. This spec was not named in the brief's file list, but adding a code necessarily requires updating it — the design (§0.5) names the new code, so the enumerated list is the thing that was stale.
   **Deviation (minimal, required):** edited `packages/sdk/src/errors/error-codes.contract.spec.ts`, inserting `'ACTOR_NOT_MEMBER',` after `'ROOM_SETTINGS_FROZEN',` to mirror the source array order.
3. Re-run `pnpm --filter @mymozhem/sdk test` → **17 suites, 210 tests, all passed** (includes the contract-version parity spec asserting package.json version == CONTRACT_VERSION == 1.2.0).
4. `pnpm --filter @mymozhem/sdk build` → `tsc -p tsconfig.json` succeeded, dist updated (core resolves SDK from dist).

### Step 5 — commit
```
git add packages/sdk
git commit -m "feat(sdk): realtime wire-конверты + код ACTOR_NOT_MEMBER, контракт 1.2.0 (REQ-CTR-004/005, REQ-RT-006/009)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
Result: 8 files changed, 179 insertions(+), 2 deletions(-); commit `23cfa4d`.

## Deviations
- One, described in Step 4.2: updated the exhaustive code-list assertion in `error-codes.contract.spec.ts`. Unavoidable — the brief itself adds the code, and that spec asserts exact list equality. No other deviation; all brief-specified code used verbatim.

## Concerns
- None for this task. Heads-up for later tasks: any future addition to `CONTRACT_ERROR_CODES` must update that exhaustive spec in the same commit.
