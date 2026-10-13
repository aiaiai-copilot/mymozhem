# Phase 0 — SDD progress ledger

Plan: docs/sessions/2026-07-11-phase-0-implementation-plan.md
Branch: phase-0-walking-skeleton
BASE (branch start): 163c17a908098e90bf2a75184e34e834ffd4ca9b

## Tasks
- Task 1: monorepo skeleton + toolchain — COMPLETE
- Task 2: SDK package + first contract schema — COMPLETE
- Task 3: boundary enforcement + gate-checks-the-gate — COMPLETE
- Task 4: core config validation (zod) — COMPLETE
- Task 5: prisma wiring + readiness DB check — COMPLETE (via Prisma 7 driver adapter)
- Task 6: health module + server composition root + e2e boot — COMPLETE
- Task 7: docker artifact + compose — COMPLETE (exit criterion verified)
- Task 8: CI workflow — COMPLETE (+ real-code boundary-check step)
- Task 9: legal questions + phase-remapping amendment (docs) — COMPLETE

## PHASE 0 COMPLETE — all 9 tasks + fixes done, final review passed
- Full CI-mirror green (install/prisma-gen/typecheck/lint/test/build/boundary-check/guardrails).
- Final whole-branch review (opus): Ready to merge; boundary enforcement verified genuinely
  live; no Critical. Its one open item (Docker boot + schema-engine seam) resolved by
  controller's clean `docker compose up --build` on committed files → /health/ready green,
  entrypoint logged "No migration found / No pending migrations" (schema-engine present in
  Linux image, migrate deploy no-op).
- Owner decisions at close: (1) postgres host port DROPPED [commit 1b5e971]; (2) merge to
  main locally (push to origin remains a separate owner decision — NOT pushed).
- Deferred to next phase (non-blocking Minors): invalid-NODE_ENV/PORT config tests;
  `.strict()` on log-event envelope when contract grows; `void seq;` comment; e2e 503 body
  assertion; entrypoint git mode 100755; a depcruise resolve-hint so `boundary-check` on an
  unbuilt fresh clone doesn't false-flag `not-to-unresolvable`.

## Cross-task carry-forward
- **DECISION (owner, Prisma stack) — affects Task 5/6/7:** Prisma 7 GA removed the query
  engine; `new PrismaClient()` requires a driver adapter (verified via node -e repro +
  context7 /prisma/prisma + Prisma AGENTS.md). Owner chose **Prisma 7 + driver adapter**
  (not downgrade to 6.x). Canonical pattern: `new PrismaClient({ adapter: new PrismaPg({
  connectionString: process.env.DATABASE_URL }) })` with `@prisma/adapter-pg` + `pg`.
  Within ADR-006 (names Prisma/Postgres, silent on major/mechanism) — NOT an ADR reopen.
  The plan's Task 5/6/7 verbatim code assumed the old engine model → this is the sanctioned
  deviation. Record as a design-note addendum at phase close (REQ-DEV-004 spirit).
  Co-location fix also required: each package generating a client needs its own `prisma`
  devDep (added to packages/core) — confirmed correct monorepo pattern.
  - Task 6: health module still injects PrismaService (DI unchanged); PrismaService
    self-builds the adapter from env → no wiring change expected.
  - **Task 6 REQUIRED (from Task 5 review, Important):** `main.ts` MUST call
    `loadConfig(process.env)` BEFORE `NestFactory.create(...)`, so a missing/empty
    DATABASE_URL fails loudly at startup before DI constructs PrismaService (whose
    constructor reads process.env.DATABASE_URL directly → would otherwise degrade to a
    silent `undefined` connection string). The plan's Task 6 main.ts already does this;
    the Task 6 dispatch must preserve that ordering. Closes the Task 5 ⚠️.
  - Task 7: `pg` is pure-JS runtime dep (no engine binary at runtime) → simplifies Docker;
    `prisma migrate deploy` in entrypoint still uses the schema-engine CLI (no-op w/o models).
- **Task 5 (Prisma):** `pnpm-workspace.yaml` currently declines Prisma build scripts
  via `allowBuilds: {'@prisma/engines': false, prisma: false}`. This was REQUIRED to
  fix a fresh-install failure on pnpm 11.1.3 (`ERR_PNPM_IGNORED_BUILDS` on a clean
  checkout, incl. `--frozen-lockfile` = CI condition) — verified empirically by the
  controller. When Task 5 wires real Prisma (`prisma generate`/engines), it may need
  to flip these to `true` so engine binaries are fetched at install. Flag for that
  implementer's dispatch.

## Task 8 REQUIRED (hard — boundary enforcement gap found in Task 6 review)
- CI (Task 8) MUST run dependency-cruiser across REAL code, not only the `guardrails`
  meta-check. Current `guardrails` script (verify-guardrails.mjs) only proves the
  enforcers FIRE on injected probes — it never cruises the actual source, so a real
  boundary violation in committed code would pass CI. Add a `boundary-check` step/script
  (e.g. `depcruise apps packages --config .dependency-cruiser.cjs`) to CI, running AFTER
  build (so `@mymozhem/core` resolves to dist, not unbuilt src → no false `not-to-unresolvable`).
  Without this, ADR-002/REQ-DEV-001 machine-enforcement is only half-wired.

## Phase-0 EXIT CRITERION — verified first-hand by controller (2026-07-16)
- `docker compose up --build` → postgres healthy → server boots; `/health/live` → 200
  {"status":"ok"}; `/health/ready` → 200 {"status":"ok","db":true} against the local
  Compose Postgres via the Prisma pg driver adapter. Nest logs clean. Torn down clean.
- FINDING for owner (Task 7, plan-mandated port): committed docker-compose.yml maps
  postgres `5432:5432` on the host — collides on any machine already running postgres on
  5432 (owner's machine has `lt-pg`; both 5432 AND 5433 are taken here). The host mapping
  is NOT needed for the artifact (server→postgres is internal compose network); removing
  it (verified) makes `docker compose up` collision-free. Surface at phase-0 close.

## Minor findings (roll-up for final review)
- Task 6: (1) e2e 503 case asserts only statusCode, not body {status:'unavailable',db:false}
  (verbatim brief); (2) app.module.ts imports PrismaModule directly alongside HealthModule
  (harmless dedup, verbatim, groundwork); (3) main.ts `void bootstrap()` has no `.catch()`
  — plan-mandated; Node ≥15 still crashes loudly on unhandledRejection, but explicit
  `.catch(e=>{console.error(e);process.exit(1)})` would be more deterministic.
- Task 1: `package.json` `guardrails` script points to `scripts/verify-guardrails.mjs`
  which doesn't exist until Task 3; not wired into CI until Task 8. Expected by task
  ordering, no action — final review just confirm the script exists by then.

## Completed
- Task 9: complete (commit fa21db1, docs verbatim-verified by controller). Created
  docs/legal/questions-for-lawyer.md + docs/spec/amendment-v1.3-phase-remapping.md
  (owner-review drafts, non-blocking). No separate reviewer (pure doc transcription).
- Task 8: complete (commits 43f425a..ac680e5, review clean). CI runs lint/typecheck/
  test/build/boundary-check/guardrails on every PR. REQUIRED addition delivered: real-code
  `boundary-check` (depcruise apps packages) AFTER build — closes the ADR-002 enforcement
  gap (guardrails alone only proves the enforcer fires). Ordering empirically verified.
  Step-scoped placeholder DATABASE_URL for `prisma generate` (no leak, confirmed via YAML
  parse). Task quality: Approved. NOTE: CI not yet run on GitHub (no push — owner decision).
- Task 7: complete (commits 5571de0..43f425a, review clean). Single Docker artifact
  boots on one command; exit criterion verified first-hand (readiness green vs local
  Postgres). Two Dockerfile deviations (turbo.json in COPY; build-stage-only DATABASE_URL
  placeholder) confirmed correct + non-leaking to runtime. allowBuilds untouched. One
  Important plan-mandated (postgres 5432:5432 host port → owner decision at phase close);
  two Minor (entrypoint git mode 100644 — harmless, Dockerfile chmods; runtime image
  keeps devDeps — plan-mandated, out of scope). Task quality: Approved.
- Task 6: complete (commits 332541b..5571de0, review clean). Server e2e 3/3 + core 6/6 +
  sdk 7/7; loadConfig-before-create verified; no real DB (PrismaService stubbed).
  Important finding FIXED [5571de0]: added machine-enforced apps/*→core-internals boundary
  rule + gate probe (ADR-002/REQ-DEV-001) — controller independently verified real-code
  clean (no false positive), rule catches the exact deep-import, 3 probes fire. Three Minor
  logged (roll-up). Task quality: Approved.
- Task 5: complete (commits fa485e4..332541b, review clean, 6/6 tests). BLOCKED then
  unblocked: Prisma 7 removed query engine → adopted driver adapter (@prisma/adapter-pg +
  pg), owner-approved, brief amended. allowBuilds untouched. One Important (plan-mandated):
  constructor reads process.env.DATABASE_URL directly → carried forward as a Task 6
  ordering requirement (loadConfig before DI). Task quality: Approved.
- Task 4: complete (commits f569d57..fa485e4, review clean, 4/4 tests). allowBuilds
  gate did NOT fire when @prisma/client was added (no workspace.yaml change). Three
  Minor, no fix: (1) core/package.json pre-declares @nestjs/*/@prisma/client deps used
  in Tasks 5-6 — NOT a §3 forward-scaffolding violation (immediate next tasks, not a
  deferred capability); (2) no invalid-NODE_ENV / PORT-boundary tests (brief specified
  exactly 4); (3) `(root)` error-path fallback untested. Task quality: Approved.
- Task 3: complete (commits 4281de2..f569d57, review clean). Guardrails live &
  self-verified (both probes fire; controller re-ran green). Includes cross-task fix
  1c328e4 (`void seq;` in Task 2 fixtures — first eslint run surfaced no-unused-vars;
  behavior-preserving, confirmed). Two Minor, no fix: (1) `void seq;` could use an
  explanatory comment; (2) plan's Step 6 instruction is incomplete for pre-core state
  (fold into plan docs for Task 4+). Task quality: Approved.
- Task 2: complete (commits c33d4d3..4281de2, review clean, 7/7 tests). Two Minor,
  no fix: (1) sdk/tsconfig.json has no `exclude` for `*.spec.ts` → spec compiled into
  dist, but inert (dist gitignored, package private) [plan-mandated]; (2) zod object
  non-strict → unexpected top-level keys pass, out-of-scope per brief's 4 invalid cases.
  Both for a later contract-hardening/publish pass. Task quality: Approved.
- Task 1: complete (commits a6df469..c33d4d3, review clean).
  Owner-adjudicated plan-mandated findings: (1) .gitignore restored to comprehensive
  version [c33d4d3]; (2) allowBuilds:false accepted (mechanically required for CI on
  pnpm 11.1.3, verified). Task quality: Approved.
