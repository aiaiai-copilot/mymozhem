# Task 8 report: CI workflow

## Status: DONE

## What was created

### `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.1.3
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec prisma generate
        env:
          # CI-only placeholder so prisma.config.ts's env('DATABASE_URL') resolves
          # during config loading. `prisma generate` does not connect to a DB;
          # mirrors the same placeholder used in the Dockerfile build stage.
          DATABASE_URL: postgresql://ci:ci@localhost:5432/ci?schema=public
      - run: pnpm run typecheck
      - run: pnpm run lint
      - run: pnpm run test
      - run: pnpm run build
      - run: pnpm run boundary-check
      - run: pnpm run guardrails
```

This follows the brief (`task-8-brief.md`) step for step, with two additions
beyond the brief, both required to make the brief's own steps actually pass
in a clean environment / close a real enforcement gap:

### Addition 1 — `boundary-check` step (required by this task's brief)

Root `package.json` gained:

```json
"boundary-check": "depcruise apps packages --config .dependency-cruiser.cjs",
```

Rationale (from the task instructions, confirmed by inspection of
`scripts/verify-guardrails.mjs`): `guardrails` only proves the enforcers
*fire* on injected probes (it writes a throwaway file that violates a rule,
runs depcruise/eslint against *that one file*, then deletes it). It never
runs dependency-cruiser across the real, committed `apps/` and `packages/`
trees. A genuine ADR-002 boundary violation landed in a real commit would
pass CI silently under the brief alone. `boundary-check` closes that gap by
running depcruise over the actual source on every CI run.

**Placement:** the `boundary-check` step is placed *after* `build` and
*before* `guardrails`. This ordering was empirically verified to matter (see
"Ordering sanity check" below): `apps/server` imports `@mymozhen s/core` via
its package entrypoint (`main: dist/index.js`), which only exists after
`packages/core`'s `tsc` build runs. If depcruise runs before `build`, it
false-flags `@mymozhem/core` as `not-to-unresolvable` because `dist/` isn't
there yet — a false failure, not a real boundary violation.

### Addition 2 — placeholder `DATABASE_URL` for the `prisma generate` step (not in the brief; required to make the brief's own step pass)

Running `pnpm exec prisma generate` with no `DATABASE_URL` set fails during
config loading:

```
Failed to load config file ... Error: PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL.
```

`prisma.config.ts` calls `env('DATABASE_URL')` eagerly when Prisma loads the
config, before `generate` ever needs to connect to anything. This is exactly
the same issue Task 7 already solved in `Dockerfile` (see its comment at
line 9-13): a build-stage-only placeholder `DATABASE_URL` so config loading
resolves; the real `DATABASE_URL` is only supplied at container runtime for
`prisma migrate deploy`. I mirrored that exact pattern — a placeholder
`DATABASE_URL` env scoped to just the `prisma generate` step in CI, with a
comment pointing at the same rationale. No database is contacted; `generate`
only reads the schema file and emits the client.

I did not need to touch `allowBuilds` — the task's anticipated failure mode
("missing engine") did not occur; this was a different, config-loading-time
issue, and the existing Docker precedent gave an unambiguous, minimal fix
(env var scoped to one step) rather than a guess.

## Local mirror run — every step verified in order, exit 0

Command sequence run (matching CI order exactly, `DATABASE_URL` supplied
only for the `prisma generate` step as it will be in the workflow):

```
pnpm install --frozen-lockfile
DATABASE_URL=postgresql://ci:ci@localhost:5432/ci?schema=public pnpm exec prisma generate
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
pnpm run boundary-check
pnpm run guardrails
```

### 1. `pnpm install --frozen-lockfile`
```
Scope: all 4 workspace projects
Already up to date
Done in 170ms using pnpm v11.1.3
=== install EXIT: 0 ===
```

### 2. `pnpm exec prisma generate` (with placeholder DATABASE_URL)
```
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from packages/core/prisma/schema.prisma.

✔ Generated Prisma Client (v7.8.0) to ./node_modules/.pnpm/@prisma+client@7.8.0_.../node_modules/@prisma/client in 39ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

=== prisma generate EXIT: 0 ===
```

### 3. `pnpm run typecheck`
```
 Tasks:    5 successful, 5 total
Cached:    2 cached, 5 total
  Time:    845ms
=== typecheck EXIT: 0 ===
```

### 4. `pnpm run lint`
```
 Tasks:    3 successful, 3 total
Cached:    0 cached, 3 total
  Time:    1.065s
=== lint EXIT: 0 ===
```

### 5. `pnpm run test`
```
@mymozhem/sdk:test:   Tests: 7 passed, 7 total
@mymozhem/core:test:  Tests: 6 passed, 6 total
@mymozhem/server:test: Tests: 3 passed, 3 total

 Tasks:    5 successful, 5 total
Cached:    5 cached, 5 total
=== test EXIT: 0 ===
```

### 6. `pnpm run build`
```
 Tasks:    3 successful, 3 total
Cached:    2 cached, 3 total
  Time:    726ms
=== build EXIT: 0 ===
```

### 7. `pnpm run boundary-check` (new step, after build)
```
$ depcruise apps packages --config .dependency-cruiser.cjs

✔ no dependency violations found (54 modules, 79 dependencies cruised)

=== boundary-check EXIT: 0 ===
```

### 8. `pnpm run guardrails`
```
$ node scripts/verify-guardrails.mjs
OK   — guardrail fired on: sdk → core import (dependency-cruiser)
OK   — guardrail fired on: module-level mutable export (eslint)
OK   — guardrail fired on: apps → core src-internals import (dependency-cruiser)

All guardrails verified alive.
=== guardrails EXIT: 0 ===
```

All 8 steps exited 0.

## Ordering sanity check (empirical proof the "after build" requirement is real)

To confirm the brief's ordering constraint is not just theoretical, I
deleted `packages/core/dist` and re-ran `boundary-check`:

```
$ rm -rf packages/core/dist && pnpm run boundary-check
$ depcruise apps packages --config .dependency-cruiser.cjs

  error not-to-unresolvable: apps/server/test/health.e2e-spec.ts → @mymozhem/core
  error not-to-unresolvable: apps/server/src/main.ts → @mymozhem/core
  error not-to-unresolvable: apps/server/src/app.module.ts → @mymozhem/core
  error not-to-unresolvable: apps/server/dist/main.js → @mymozhem/core
  error not-to-unresolvable: apps/server/dist/app.module.js → @mymozhem/core

x 5 dependency violations (5 errors, 0 warnings). 39 modules, 52 dependencies cruised.
=== boundary-check w/o dist EXIT: 5 ===
```

This confirms: without a built `dist/`, depcruise cannot resolve
`@mymozhem/core`'s package entrypoint and falsely reports it as
unresolvable — exactly the false-positive the task instructions warned
about. I then re-ran `pnpm run build` (turbo restored `dist/` from its
cache) and re-ran both `boundary-check` and `guardrails` to confirm they
were back to green before committing:

```
=== rebuild EXIT: 0 ===
✔ no dependency violations found (54 modules, 79 dependencies cruised)
=== boundary-check after rebuild EXIT: 0 ===
All guardrails verified alive.
=== guardrails after rebuild EXIT: 0 ===
```

## `git show --stat`

```
commit ac680e5b0906ea4ffdf8bb220d15709f03924bad
Author: alexanderlapygin <alexanderlapygin@gmail.com>

    ci: lint/typecheck/test/build + boundary-check + guardrails on every PR (REQ-DEV-001)

    guardrails (verify-guardrails.mjs) only proves the enforcers fire on
    injected probes; it does not run dependency-cruiser across the actual
    source. Add a boundary-check step (depcruise apps packages) after build
    so real ADR-002 violations in committed code fail CI, not just probes.
    Must run after build: depcruise resolves @mymozhem/core via its built
    dist/, not un-built src/.

 .github/workflows/ci.yml | 31 +++++++++++++++++++++++++++++++
 package.json             |  1 +
 2 files changed, 32 insertions(+)
```

Only `.github/workflows/ci.yml` (new) and `package.json` (+1 line) are in
the commit. Nothing under `.superpowers/` was staged or committed. Branch
remains `phase-0-walking-skeleton`; not pushed; no GitHub Actions run
triggered.

## Files changed

- `/Users/alexanderlapygin/Projects/mymozhem/.github/workflows/ci.yml` (new)
- `/Users/alexanderlapygin/Projects/mymozhem/package.json` (+1 script line)

## Self-review

- Completeness: ci.yml has checkout, pnpm setup (11.1.3), node 24 + pnpm
  cache, install --frozen-lockfile, prisma generate, typecheck, lint, test,
  build, boundary-check (after build, before guardrails), guardrails. Root
  `boundary-check` script added to `package.json`. All present.
- Full local mirror sequence exits 0 at every step — evidence pasted above,
  including the extra ordering sanity check (delete dist → false failure →
  rebuild → green again).
- Discipline: no forward scaffolding. No extra jobs, no deploy step, no
  matrix, no additional workflows. Single job, single runner, steps as
  specified plus the two required additions (boundary-check step +
  DATABASE_URL placeholder for prisma generate), both scoped to the minimum
  needed.
- Commit hygiene: `git show --stat` shows only `.github/workflows/ci.yml`
  and `package.json`; nothing from `.superpowers/`.

## Concerns

1. **`DATABASE_URL` placeholder addition was not in the brief.** It was
   necessary because `pnpm exec prisma generate` fails at config-load time
   without it (independent of the `boundary-check` addition this task
   explicitly required). I resolved it using the exact precedent already
   established and comment-documented in Task 7's `Dockerfile` (same
   placeholder pattern, same rationale: config loading needs the env var to
   resolve, `generate` never contacts a DB). I judged this fell within
   "verify every CI step passes locally" rather than being a design
   decision requiring escalation, since the fix is a narrow, precedented,
   zero-risk env-var scoped to one step — not a new architectural choice.
   Flagging it here per the task's own instruction to report anything the
   brief didn't cover.
2. No other concerns. `boundary-check` and `guardrails` both print their
   expected success strings ("no dependency violations found" / "All
   guardrails verified alive") against real, unmodified code.
