# Task 3 Report — Boundary enforcement and the gate-checks-the-gate script

## What was implemented

Three files created verbatim per the brief (`.superpowers/sdd/task-3-brief.md`):

1. **`.dependency-cruiser.cjs`** — 5 forbidden rules: `sdk-is-leaf`, `app-only-through-sdk`,
   `socketio-only-in-realtime`, `no-circular`, `not-to-unresolvable`. Transcribed verbatim
   (names, selectors, comments, severities, options block).
2. **`eslint.config.js`** — flat config (ESLint 9), `tseslint.configs.recommended` (non-type-checked),
   plus `no-restricted-syntax` rules banning module-level `let`/`var` (including named-export forms)
   per REQ-CORE-004. Transcribed verbatim.
3. **`scripts/verify-guardrails.mjs`** — gate-checks-the-gate script. Injects a boundary probe
   (`packages/sdk/src/__guardrail_probe__.ts` importing `../../core/src/health/health.module`)
   and a mutable-state probe (`scripts/__probe__/mutable.ts`, top-level `let` export), asserts
   both enforcers fail on them, then removes the probes in a `finally` block. Transcribed verbatim.

`package.json` already had `"guardrails": "node scripts/verify-guardrails.mjs"` wired from an
earlier session — no change needed there.

## One deviation from the file list, with justification

Running `pnpm exec eslint packages/sdk/src` (Step 3) initially failed with a real, pre-existing
`@typescript-eslint/no-unused-vars` error in Task 2's `packages/sdk/src/events/log-event.fixtures.ts`
(destructured `seq` used only to omit it via a rest pattern — this is the **first time ESLint has
ever run** in the repo, since Task 3 creates `eslint.config.js`). This is unrelated to the new
boundary/mutable-state rules — a genuinely latent bug the new linter surfaced. Since Step 3 requires
both enforcers to run clean on real code as a prerequisite baseline, I fixed it minimally
(`void seq;`) and committed it **separately, before** the guardrails commit, so the Step 7 commit
stays exactly as specified. Commit `1c328e4`.

## Step 3 — both enforcers clean on real code

```
$ pnpm exec depcruise packages --config .dependency-cruiser.cjs
✔ no dependency violations found (14 modules, 15 dependencies cruised)

$ pnpm exec eslint packages/sdk/src
(no output, exit 0)
```

## Step 5 — guardrails script, both probes fire, exit 0

```
$ pnpm run guardrails
OK   — guardrail fired on: sdk → core import (dependency-cruiser)
OK   — guardrail fired on: module-level mutable export (eslint)

All guardrails verified alive.
```
Exit code: 0. Confirmed the boundary probe fired via `not-to-unresolvable` (packages/core does not
exist yet — exactly the intentional design called out in the brief's note after Step 1). Probe
files were auto-removed (`git status` clean afterward).

## Step 6 — meta-check: dead guardrail caught, then restored

**Important finding, resolved:** commenting out only `sdk-is-leaf` (as literally stated in the
brief) was **not sufficient** to reproduce a dead guardrail in the current repo state. Because
`packages/core` doesn't exist yet, the `not-to-unresolvable` rule redundantly catches the exact
same probe import via `couldNotResolve`, masking the disabled `sdk-is-leaf` rule. First attempt
(only `sdk-is-leaf` commented out) still produced:
```
OK   — guardrail fired on: sdk → core import (dependency-cruiser)
OK   — guardrail fired on: module-level mutable export (eslint)

All guardrails verified alive.
```
(exit 0 — not the expected FAIL). This is the same redundancy the brief's own note documents for
Step 5 ("either way depcruise exits non-zero") — it also applies in reverse for Step 6's negative
test. To actually exercise the "did NOT fire" path, I additionally commented out `not-to-unresolvable`
(both temporarily, with a `// TEMP (Step 6 meta-check)` comment marking each). Result:

```
$ pnpm run guardrails
FAIL — guardrail did NOT fire on: sdk → core import (dependency-cruiser)
OK   — guardrail fired on: module-level mutable export (eslint)

Guardrails are NOT enforcing. Fix before merge.
```
Exit code: 1. This confirms `verify-guardrails.mjs` correctly detects a fully-dead boundary
guardrail.

**Restore:** rewrote `.dependency-cruiser.cjs` back to the exact verbatim content from Step 1 (no
TEMP comments, both rules active). Re-ran:
```
$ pnpm run guardrails
OK   — guardrail fired on: sdk → core import (dependency-cruiser)
OK   — guardrail fired on: module-level mutable export (eslint)

All guardrails verified alive.
```
Exit 0 — back to all-OK. `grep -c "TEMP (Step 6" .dependency-cruiser.cjs` → `0`.

## Commits

Two commits on `phase-0-walking-skeleton` (not pushed):

```
f569d57 feat: machine-enforced boundary + gate-checks-the-gate (ADR-002, REQ-CTR-001, REQ-DEV-001)
1c328e4 fix(sdk): mark destructured seq as used in missing-seq fixture
```

`git show --stat f569d57`:
```
 .dependency-cruiser.cjs       | 45 ++++++++++++++++++++++++++++++++++++++++
 eslint.config.js              | 34 ++++++++++++++++++++++++++++++
 scripts/verify-guardrails.mjs | 48 +++++++++++++++++++++++++++++++++++++++++++
 3 files changed, 127 insertions(+)
```
`pnpm-lock.yaml` was included in `git add` per Step 7 but produced no diff (no new deps were
needed — dependency-cruiser/eslint/typescript-eslint were already installed from the Task 1
toolchain), so it does not appear in the commit — correct, since there was nothing to stage.

`git show --stat 1c328e4`:
```
 packages/sdk/src/events/log-event.fixtures.ts | 1 +
 1 file changed, 1 insertion(+)
```

## Self-review

- **Completeness:** all three files transcribed verbatim (rule names, selectors, comments,
  severities all match the brief). Step 3 clean, Step 5 both fire + exit 0, Step 6 dead-guardrail
  caught (after also disabling the redundant `not-to-unresolvable` rule) then restored to all-OK.
- **Discipline:** no `packages/core`, `packages/app-*`, or `realtime` directories created. No
  probe files left in the tree (`__guardrail_probe__.ts`, `scripts/__probe__/` both absent after
  every run). `packages/core` absence confirmed intentional per the brief's critical subtlety note.
- **Commit hygiene:** `f569d57` contains exactly the 3 new files, nothing else. Nothing from
  `.superpowers/` was ever staged or committed (verified via `git log --all -- .superpowers` →
  empty, and `git show --stat` on both commits). `.dependency-cruiser.cjs` is restored to the
  verbatim Step-1 content (sdk-is-leaf and not-to-unresolvable both active, no TEMP comments).
- **Output pristine:** final `git status --porcelain` is empty.

## Concerns

1. The Step 3 "no errors" expectation required a one-line fix to Task 2's fixture file
   (`log-event.fixtures.ts`) — a genuine unused-variable bug newly surfaced by turning on
   ESLint for the first time in this repo. Committed separately (`1c328e4`) before the guardrails
   commit so Step 7's file list stays exact. Flagging in case the owner wants this folded into
   Task 2's history instead, or reviewed independently.
2. Step 6 as literally written in the brief ("comment out the sdk-is-leaf rule") does not by
   itself reproduce a dead-guardrail failure while `packages/core` doesn't exist yet, because
   `not-to-unresolvable` redundantly covers the same probe. I resolved this by also disabling
   `not-to-unresolvable` for the duration of the meta-check (both restored afterward). This is a
   gap in the brief's Step 6 instructions worth noting for future phases — once `packages/core`
   exists (Task 4+), the same test (disabling only `sdk-is-leaf`) would behave exactly as
   originally written, since the import would then resolve and `not-to-unresolvable` would no
   longer redundantly fire.

No blockers. Both guardrails demonstrably alive; meta-check demonstrably catches a dead one.
