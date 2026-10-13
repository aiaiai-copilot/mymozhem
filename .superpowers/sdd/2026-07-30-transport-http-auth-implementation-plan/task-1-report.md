# Task 1 report: SDK — join/token DTO, transport error codes, contract 1.1.0

**Status:** DONE · commit `6ca517e` on `phase-1-transport-http-auth`
**REQ closed:** REQ-ID-003 (join DTO), REQ-ID-016 (token DTO), REQ-SEC-006 (error codes), REQ-CTR-004 (version parity).

## What was done

Followed the brief's steps verbatim, TDD RED → GREEN:

1. **RED:** wrote `src/auth/join-request.fixtures.ts` + `src/auth/join-request.contract.spec.ts` exactly as the brief specified. Ran `pnpm --filter @mymozhem/sdk test -t joinRequest` → failed with TS2307 `Cannot find module './join-request'` (1 suite failed, 182 tests skipped).
2. **GREEN:** created `src/auth/join-request.ts`, `src/auth/token-response.ts`, `src/auth/token-response.contract.spec.ts` with the brief's exact code.
3. Added the 6 transport error codes to `CONTRACT_ERROR_CODES` in `src/errors/error-codes.ts` with the brief's separator comment.
4. `CONTRACT_VERSION` → `'1.1.0'`; `packages/sdk/package.json` `"version"` → `"1.1.0"`.
5. Added the three `auth/*` exports to `src/index.ts` (appended after membership, matching existing ordering).

## Deviations from the brief (with reasons)

1. **`src/errors/error-codes.contract.spec.ts` was modified, not just "left alone".** The file exists, and its first test asserts the *exact* enumeration (`toEqual`) of the 10 old codes. Adding codes without updating it would have left the suite red. Per the brief's "modify if exists; do not create a duplicate" clause, I extended the expected list in that existing spec with the 6 new codes (no new spec file created). The test name ("exports exactly the codes named by the design §8") was left as-is.
2. **Ran `pnpm --filter @mymozhem/sdk build` after tests.** Not in the brief, but `packages/core` resolves `@mymozhem/sdk` through its gitignored `dist/` (main: `dist/index.js`); leaving stale 1.0.0 artifacts would have handed Task 2+ an inconsistent workspace. Build output is gitignored, so the commit is unaffected.
3. **Verified downstream impact beyond the brief's Step 5:** ran `pnpm --filter @mymozhem/core test` (unit specs only; `*.int-spec.ts` excluded by testMatch and need a DB) — 7 suites / 83 tests pass. Grep confirmed core references `CONTRACT_VERSION` dynamically (never hardcodes `'1.0.0'`), so the version bump breaks nothing.

Pre-verified the context the parent flagged: `../identity/display-name` exists and exports `displayNameSchema` — the brief's import path was used unchanged. zod v4 `z.strictObject` confirmed in use (existing `error-codes.ts` uses it).

## Test commands and output tails

- `pnpm --filter @mymozhem/sdk test -t joinRequest` (RED):
  `Test Suites: 1 failed, 14 skipped … TS2307: Cannot find module './join-request'`
- `pnpm --filter @mymozhem/sdk test` (GREEN):
  `Test Suites: 16 passed, 16 total · Tests: 198 passed, 198 total` — includes `contract-version.contract.spec.ts` (parity) and both new auth specs.
- `pnpm --filter @mymozhem/sdk typecheck` → clean; `pnpm --filter @mymozhem/sdk lint` → clean.
- `pnpm --filter @mymozhem/core test`:
  `Test Suites: 7 passed, 7 total · Tests: 83 passed, 83 total`

## Self-review findings

- Spec-compliance: `joinRequestSchema` is a strictObject with `code: trim().min(1)` and the shared `displayNameSchema` (trim + 1..40) — matches REQ-ID-003 and the interface declared in the brief; `tokenResponseSchema` carries no refresh field (comment cites REQ-ID-008 rationale) — matches REQ-ID-016. All 6 new codes present, typed via `ContractErrorCode` union automatically. Version parity in both places — REQ-CTR-004.
- Code-quality: comment density and fixture style match neighbouring files (`display-name.*`, `error-codes.*`). No dependencies added; lockfile untouched (`git status` after commit shows only the pre-existing untracked `AGENTS.md`, deliberately not committed).
- No concerns.
