# Task 4 Report: Core config validation (zod)

## Summary

Created the first `@mymozhem/core` package with zod-based startup config
validation (`loadConfig`, `configSchema`, `AppConfig`), implementing
REQ-OPS-003. Followed brief steps 1-9 verbatim, with TDD RED→GREEN.

## Files created

- `packages/core/package.json` — verbatim from brief (pinned versions:
  zod ^4.0.0, @nestjs/* ^11.0.0, @prisma/client ^7.6.0, jest ^29.7.0,
  ts-jest ^29.2.5, typescript ^5.7.0).
- `packages/core/tsconfig.json` — extends `../../tsconfig.base.json`, verbatim.
- `packages/core/jest.config.js` — ts-jest preset, verbatim.
- `packages/core/src/config/config.schema.spec.ts` — verbatim test (4 cases:
  defaults, PORT coercion, missing DATABASE_URL throws, out-of-range PORT
  throws).
- `packages/core/src/config/config.schema.ts` — verbatim: `configSchema`
  (zod object with NODE_ENV enum default 'development', PORT coerced number
  1-65535 default 3000, DATABASE_URL non-empty string), `AppConfig` type via
  `z.infer`, `loadConfig(env)` using `safeParse` and throwing
  `Invalid configuration: ...` with per-issue path/message detail on failure.
- `packages/core/src/index.ts` — `export * from './config/config.schema';`
  only. No Prisma, no Nest modules, no health code — scope held to Task 4.

## TDD evidence

### Step 3 — Install

```
$ pnpm install
Scope: all 3 workspace projects
...
Packages: +22
Done in 6.7s using pnpm v11.1.3
```

Completed cleanly. **The pnpm build-script allow-list gate did NOT fire** —
`git status --short` after install showed only `pnpm-lock.yaml` modified;
`pnpm-workspace.yaml` was untouched (confirmed via `git diff --stat
pnpm-workspace.yaml` → empty). No new Prisma-related package required an
`allowBuilds` entry. **No `allowBuilds` change was made** — the existing
`prisma: false` / `@prisma/engines: false` entries from Task 1 were
sufficient; `@prisma/client` apparently carries no separate build script
requiring approval at this version, or its build artifacts are covered by
the existing declines.

### Step 5 — RED

Command: `pnpm --filter @mymozhem/core test`

```
FAIL src/config/config.schema.spec.ts
  ● Test suite failed to run

    src/config/config.schema.spec.ts:1:28 - error TS2307: Cannot find module
    './config.schema' or its corresponding type declarations.

Test Suites: 1 failed, 1 total
Tests:       0 total
```

Failure reason: `config.schema.ts` did not exist yet (test written before
implementation, per TDD). Confirms the test actually exercises the intended
module path and fails for the expected reason (missing module, not a syntax
or config error).

### Steps 6-7 — Implementation

Created `config.schema.ts` and `index.ts` exactly as specified in the brief.

### Step 8 — GREEN

Command: `pnpm --filter @mymozhem/core test`

```
PASS src/config/config.schema.spec.ts
  loadConfig
    ✓ applies defaults when only DATABASE_URL is provided (1 ms)
    ✓ coerces PORT from string (1 ms)
    ✓ throws when DATABASE_URL is missing (2 ms)
    ✓ throws when PORT is out of range

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
Time:        0.456 s
```

Pristine — 4/4 passing, no warnings.

### Additional verification (not required by brief but run for confidence)

- `pnpm --filter @mymozhem/core lint` → clean, no output/errors.
- `pnpm --filter @mymozhem/core typecheck` → clean, no output/errors.
- `npm run guardrails` (repo-wide gate-checks-the-gate from Task 3):

```
OK   — guardrail fired on: sdk → core import (dependency-cruiser)
OK   — guardrail fired on: module-level mutable export (eslint)

All guardrails verified alive.
```

Confirms the Task 3 boundary/mutable-state guardrails remain alive with the
new `core` package present, and that `config.schema.ts` (using only `const`
and a top-level `function` declaration — no `let`/`var` at module level)
does not itself trip the mutable-state rule.

## allowBuilds gate

**Did not fire.** No changes to `pnpm-workspace.yaml`. Confirmed via
`git status --short` and `git diff --stat pnpm-workspace.yaml` (empty) after
`pnpm install`.

## git show --stat

```
commit fa485e46171704af45a43fa3846caadaa84a25d3
    feat(core): zod startup config validation (REQ-OPS-003)

 packages/core/jest.config.js                   |   6 +
 packages/core/package.json                     |  31 +++
 packages/core/src/config/config.schema.spec.ts |  25 +++
 packages/core/src/config/config.schema.ts      |  22 +++
 packages/core/src/index.ts                     |   1 +
 packages/core/tsconfig.json                    |   5 +
 pnpm-lock.yaml                                 | 256 +++++++++++++++++++++++++
 7 files changed, 346 insertions(+)
```

Only `packages/core/*` and `pnpm-lock.yaml` — nothing from `.superpowers/`,
no `pnpm-workspace.yaml` change (matches expectation since the allowBuilds
gate did not fire).

## Self-review

- **Completeness:** `config.schema.ts` (loadConfig + AppConfig +
  configSchema), test file (4 cases: defaults, PORT coercion, missing
  DATABASE_URL throws, out-of-range PORT throws), `index.ts`,
  package.json/tsconfig.json/jest.config.js — all present, verbatim from
  brief. 4/4 tests pass.
- **Discipline:** Nothing beyond config added — no Prisma usage, no Nest
  modules, no health/prisma code. `package.json` declares `@prisma/client`,
  `@nestjs/common`, `@nestjs/core` etc. as dependencies (per brief, for later
  tasks) but none are imported/used in Task 4 source. No `true` values in
  `allowBuilds` (unchanged from Task 1: `prisma: false`,
  `@prisma/engines: false`).
- **Commit hygiene:** `git show --stat` confirms only `packages/core/*` +
  `pnpm-lock.yaml` staged and committed; nothing from `.superpowers/`
  touched.
- **Test output:** pristine, no warnings, no console noise.

## Concerns

None. The anticipated allowBuilds gate did not fire for this task's
install, so no new declines were needed and `pnpm-workspace.yaml` was left
untouched.
