# Task 1 report: SDK 1.8.0 — код ошибки IDENTITY_ANONYMIZED

**Status:** DONE_WITH_CONCERNS
**Commit:** `7e564ef` (branch `phase-4-hardening`, worktree `.worktrees/phase-4-hardening`)
**Message:** `feat(sdk): IDENTITY_ANONYMIZED contract error code (C-8.1), SDK 1.8.0`

## What changed

Files named in the brief (per controller's ruling on the spec filename):

1. `packages/sdk/src/errors/error-codes.contract.spec.ts` — RED first:
   - `'IDENTITY_ANONYMIZED',` added to the expected `CONTRACT_ERROR_CODES` array immediately before `'INTERNAL_ERROR'`.
   - New `it.each(['IDENTITY_ANONYMIZED'] as const)('accepts phase-4 code %s', ...)` row after the phase-3 `it.each`.
2. `packages/sdk/src/errors/error-codes.ts` — `'IDENTITY_ANONYMIZED'` inserted into `CONTRACT_ERROR_CODES` before `'INTERNAL_ERROR'`, with the brief's phase-4 comment verbatim.
3. `packages/sdk/src/contract-version.ts` — `CONTRACT_VERSION = '1.8.0'`.
4. `packages/sdk/package.json` — `"version": "1.8.0"`.

Fifth file (deviation, see Concerns):

5. `packages/sdk/src/contract-version.contract.spec.ts` — one fixture updated: in the
   "rejects an incompatible range" `it.each`, `'>=1.8.0'` → `'>=2.0.0'`.

## RED output excerpt

Run: `pnpm --filter @mymozhem/sdk test -- error-codes.contract.spec` (filter matched 20 tests — no "0 tests" warning).

```
 ● contract errors › exports exactly the codes named by the design §8
        "REWARD_ALREADY_RESOLVED",
    -   "IDENTITY_ANONYMIZED",
        "INTERNAL_ERROR",
      at Object.<anonymous> (src/errors/error-codes.contract.spec.ts:10:39)

 ● contract errors › accepts phase-4 code IDENTITY_ANONYMIZED
    Expected: true
    Received: false
      at src/errors/error-codes.contract.spec.ts:82:61

Tests: 2 failed, 18 passed, 20 total
```

## GREEN output excerpt

Run: `pnpm --filter @mymozhem/sdk test && pnpm --filter @mymozhem/sdk build`

```
Test Suites: 29 passed, 29 total
Tests:       328 passed, 328 total
$ tsc -p tsconfig.json   (exit 0, no errors)
```

The contract-version spec's auto-check `pkg.version ≡ CONTRACT_VERSION` passes at 1.8.0.

## Concerns

1. **Fifth file touched, contrary to the brief's file constraint.** After the version bump to
   1.8.0, the pre-existing fixture `'>=1.8.0'` in `contract-version.contract.spec.ts:30`
   ("rejects an incompatible range") became *satisfied* by `CONTRACT_VERSION`, failing 1 of 328
   tests. The fixture was version-sensitive by construction (it meant "a range above the current
   version"). Minimal intent-preserving fix: `'>=1.8.0'` → `'>=2.0.0'` (stays incompatible until
   a contract major 2, which ADR-002 says advances deliberately). Without this edit the suite
   cannot be GREEN at SDK 1.8.0 — there is no way to close it within the four named files.
   The fix is included in the same commit.
2. Note for future minor bumps: any `>=1.x.0`-style fixture in that spec will go stale again at
   each minor. `'^2.0.0'` / `'>=2.0.0'` / `'0.9.x'` are now all major-boundary fixtures and are
   stable across minors.
3. No dependency changes; lockfile untouched.
