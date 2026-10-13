# Task 7 Report: Run the integration lane in CI

## Summary

Successfully added the Testcontainers integration test step to `.github/workflows/ci.yml`. The step runs `pnpm run test:int` after unit tests and before the build step, with a properly configured DATABASE_URL placeholder environment variable.

## Implementation

### Step Added
Added the following step to `.github/workflows/ci.yml` at line 29-35 (after `pnpm run test` step):

```yaml
      - run: pnpm run test:int
        env:
          # Testcontainers spins up its own ephemeral Postgres via Docker; this is a
          # placeholder so prisma.config.ts's env('DATABASE_URL') resolves during CLI
          # config loading. The harness overrides DATABASE_URL with the live container
          # URL before `migrate deploy` (see postgres.testcontainer.ts).
          DATABASE_URL: postgresql://ci:ci@localhost:5432/ci?schema=public
```

## Verification

### YAML Validation & Step Order
Verified with Python YAML parser. Output:

```
YAML parsed successfully.

Step order in build job:
1. actions/checkout@v4
2. pnpm/action-setup@v4
3. actions/setup-node@v4
4. pnpm install --frozen-lockfile
5. pnpm exec prisma generate
6. pnpm run typecheck
7. pnpm run lint
8. pnpm run test
9. pnpm run test:int
10. pnpm run build
11. pnpm run boundary-check
12. pnpm run guardrails

Verification:
  test:int step found at position 9
  Placement after "pnpm run test": True
  Placement before "pnpm run build": True
```

All verifications passed. The step is correctly positioned after unit tests and before the build step, exactly as specified in the brief.

## Files Changed

- `.github/workflows/ci.yml`: added 7 lines (the integration test step with environment variable and comment)

## Commit

```
ae87514 ci: run Testcontainers integration lane (REQ-DEV-001)
```

Commit message follows the brief exactly and includes the Co-Authored-By trailer.

## Self-Review

**Spec Coverage:**
- REQ-DEV-001 (CI gates on every PR) — integration tests now part of the CI pipeline, running after unit tests. ✔
- REQ-OPS-002 (migrations applied with `prisma migrate deploy`) — the DATABASE_URL placeholder is correctly documented; the test harness overrides it with live container URL before migration. ✔

**Step Placement:** Correct — after `pnpm run test` (step 8) and before `pnpm run build` (step 10). ✔

**Environment Variable:**
- Placeholder value matches the pattern used in the `prisma generate` step. ✔
- Comment style and content match the existing `prisma generate` step. ✔
- Correctly explains that Testcontainers spins up its own ephemeral Postgres and the harness overrides the URL. ✔

**No Unintended Changes:**
- Only `.github/workflows/ci.yml` was modified. ✔
- No existing CI steps were reordered, removed, or have `continue-on-error` added. ✔
- No changes to quality gates (lint, typecheck, unit tests, build, boundary-check, guardrails). ✔

**YAML Validity:** File parses without errors; indentation is consistent with existing steps. ✔

## Important Note: CI Not Yet Executed

**Scope Change Compliance:** Per the owner's standing decision to defer all pushes, this task skipped step 4 of the brief (push and confirm CI is green). The branch and main remain local.

**Consequence:** The CI change has been verified by YAML parsing and inspection only. The `pnpm run test:int` step has NOT actually executed in GitHub Actions because the branch was not pushed. When the branch is eventually pushed (by the owner's decision), the integration test lane will run for the first time in CI.

## Issues and Concerns

None. The implementation is clean and complete within the constrained scope.
