# Task 6 review fix — apps/*→core-internals boundary rule + gate probe

## Context

Task 6 introduced `apps/server`, which legitimately imports `@mymozhem/core`
via its package entrypoint. The review flagged a real gap: `.dependency-cruiser.cjs`
had no rule preventing `apps/*` from deep-importing `packages/core/src/**`
internals (bypassing the entrypoint). This fix closes that gap and adds a
gate-checks-the-gate probe, following the existing pattern in
`scripts/verify-guardrails.mjs`.

## 1. Rule added to `.dependency-cruiser.cjs`

```js
{
  name: 'apps-only-through-core-entrypoint',
  comment:
    'apps/* обращаются к ядру только через пакетный entrypoint @mymozhem/core, не в его src-внутренности (ADR-002, REQ-DEV-001).',
  severity: 'error',
  from: { path: '^apps/' },
  to: { path: '^packages/core/src' },
},
```

Inserted between `app-only-through-sdk` and `socketio-only-in-realtime`. All
existing rules (`sdk-is-leaf`, `app-only-through-sdk`, `socketio-only-in-realtime`,
`no-circular`, `not-to-unresolvable`) kept intact and in place.

## 2. No false positive on the legit entrypoint import

`packages/core` was built first (`pnpm --filter @mymozhem/core build`), so
`packages/core/dist` exists and `@mymozhem/core`'s `main`/`types` resolve to
`dist/…`, not `src/…`. Then, with all rules (including the new one) active:

```
$ pnpm exec depcruise apps packages --config .dependency-cruiser.cjs

✔ no dependency violations found (50 modules, 71 dependencies cruised)
```

The legit `apps/server` → `@mymozhem/core` import is not a false positive.

## 3. Gate probe added to `scripts/verify-guardrails.mjs`

Added a third probe following the existing pattern (write temp violating
file, `expectFailure` asserts depcruise fires, clean up in `finally`):

```js
// 3) Apps-boundary probe: a file in apps/server deep-importing core's src
// internals instead of the package entrypoint (forbidden: apps-only-through-core-entrypoint).
const appsProbe = 'apps/server/src/__guardrail_probe__.ts';
writeFileSync(
  appsProbe,
  "import '../../../packages/core/src/health/health.module';\nexport const probe = 1;\n",
);
```

`expectFailure` is called against `pnpm exec depcruise ${appsProbe} --config .dependency-cruiser.cjs`,
and the probe file is removed in the `finally` block alongside the existing
two probes (sdk boundary probe, mutable-export probe).

## 4. End-state verification

### All three probes fire (rules restored)

```
$ pnpm run guardrails
OK   — guardrail fired on: sdk → core import (dependency-cruiser)
OK   — guardrail fired on: module-level mutable export (eslint)
OK   — guardrail fired on: apps → core src-internals import (dependency-cruiser)

All guardrails verified alive.
```
Exit code 0.

### Meta-check: dead-guardrail caught

Temporarily commented out BOTH `apps-only-through-core-entrypoint` and
`not-to-unresolvable` (packages/core/src exists on disk, so the deep import
in the apps probe resolves and would otherwise be silently allowed once the
new rule is gone — same reasoning as the existing sdk probe):

```
$ pnpm run guardrails
OK   — guardrail fired on: sdk → core import (dependency-cruiser)
OK   — guardrail fired on: module-level mutable export (eslint)
FAIL — guardrail did NOT fire on: apps → core src-internals import (dependency-cruiser)

Guardrails are NOT enforcing. Fix before merge.
EXIT CODE: 1
```

This proves the script actually catches a dead guardrail for the new probe
(not just a green rubber stamp).

Both rules were then restored verbatim (diffed against the intended final
state — identical), and:

```
$ pnpm run guardrails
OK   — guardrail fired on: sdk → core import (dependency-cruiser)
OK   — guardrail fired on: module-level mutable export (eslint)
OK   — guardrail fired on: apps → core src-internals import (dependency-cruiser)

All guardrails verified alive.
```
Exit code 0, all-OK confirmed.

### Real code still clean after restore

```
$ pnpm exec depcruise apps packages --config .dependency-cruiser.cjs

✔ no dependency violations found (50 modules, 71 dependencies cruised)
```

### No probe files leftover

```
$ git status
Изменения, которые будут включены в коммит:
	изменено:      .dependency-cruiser.cjs
	изменено:      scripts/verify-guardrails.mjs
```
Only the two intended files staged/changed; no `__guardrail_probe__` or
`__probe__` artifacts left behind.

## Commit

```
$ git show --stat HEAD
commit 5571de0d854895080dcdee643dd44504c484fb3e
Author: alexanderlapygin <alexanderlapygin@gmail.com>
Date:   Thu Jul 16 14:34:03 2026 +0300

    feat(guardrails): enforce apps/*→core-internals boundary + gate probe (ADR-002, REQ-DEV-001)

    apps/server legitimately imports @mymozhem/core via its package entrypoint,
    but nothing machine-enforced that a future deep-import of
    packages/core/src/** internals (bypassing the entrypoint) would be caught.
    Add the apps-only-through-core-entrypoint forbidden rule and a matching
    gate-checks-the-gate probe in verify-guardrails.mjs, following the existing
    sdk/mutable-export probe pattern.

    Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

 .dependency-cruiser.cjs       |  8 ++++++++
 scripts/verify-guardrails.mjs | 13 +++++++++++++
 2 files changed, 21 insertions(+)
```

Not pushed (per instructions — commit only, on `phase-0-walking-skeleton`).

## Concerns

None. Rule and probe behave exactly as specified; no scope creep (only the
two named files touched); nothing under `.superpowers/` staged.
