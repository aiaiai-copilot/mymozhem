# Task 5 report: Prisma wiring and readiness DB check

## Status: DONE (resolved via owner-approved amendment — see "Resolution" at end)

> The original BLOCKED analysis below is retained for the record. The owner reviewed it,
> confirmed the diagnosis, and chose **Prisma 7 + driver adapter**. The task is now complete;
> the "Resolution (2026-07-16)" section at the very end documents the finish.

## Status (original): BLOCKED (architectural mismatch between brief and installed Prisma 7 behavior)

Steps 1–5 and 7 completed. Step 6 (implement `PrismaService`/`PrismaModule` verbatim) was
written verbatim, but Step 8 (GREEN) fails for a reason outside the brief's anticipated
failure modes: **Prisma 7 GA's `PrismaClient` cannot be constructed at all — with any schema,
any env, any resolution fix — without passing a driver adapter (or `accelerateUrl`) to the
constructor.** `new PrismaService()` (no args), which is exactly what the brief's test file
does (Step 4, verbatim, unmodified), throws synchronously at construction, before either test
body even runs `$queryRaw`. This is not fixable by anything in the CRITICAL section
(allowBuilds/engines) — it is a hard breaking change in Prisma 7's client architecture,
confirmed both via the actual runtime error and via Prisma's own docs/AGENTS.md. Stopping here
per the task's own instruction ("If anything is ambiguous or a command fails in a way not
covered above, ask/escalate rather than guessing") rather than unilaterally redesigning
`PrismaService`'s constructor and adding new driver-adapter dependencies not specified in the
brief.

---

## What was done (Steps 1–5, 7 — all complete and verified)

### Step 1 — `packages/core/prisma/schema.prisma` (created, verbatim)
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}
```
No models, no `multiSchema`, no `schemas=[...]` — per the brief's design note. This is unaffected
by the blocker below and is fine as-is.

### Step 2 — `prisma.config.ts` at repo root (created, verbatim)
```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'packages/core/prisma/schema.prisma',
  migrations: { path: 'packages/core/prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

### Step 3 — validate + generate: succeeded, but required a real fix beyond the CRITICAL section

`pnpm exec prisma validate` and `pnpm exec prisma generate` were tried as-is first. `validate`
succeeded immediately (schema-only, doesn't touch `@prisma/client`). `generate` failed — **not**
because of missing engine binaries (the schema-engine binary for `@prisma/engines@7.8.0` was
already present in `node_modules/.pnpm`, and `pnpm exec prisma --version` ran cleanly with no
`allowBuilds` prompt), but with:

```
Error: Could not resolve @prisma/client.
Please try to install it with pnpm i @prisma/client and rerun pnpm dlx "prisma generate" 🙏.
```

Root cause (traced into `prisma`'s bundled CLI, function `d3t`/`QLe` in
`node_modules/.pnpm/prisma@7.8.0.../node_modules/prisma/build/index.js`): Prisma 7's
client generator computes a *default output location* by resolving both the `prisma` package
and the `@prisma/client` package from the schema file's directory upward through `node_modules`,
then requires them to be "co-located" (one must be a subpath of the other's resolved directory).
In this repo, `prisma` was a **root-only** devDependency (`package.json`) while `@prisma/client`
is a dependency of `packages/core` only — so `prisma` resolved to
`<repo-root>/node_modules/prisma` while `@prisma/client` resolved to
`packages/core/node_modules/@prisma/client`, two unrelated subtrees. The co-location check
failed and `generate` refused to run, regardless of which directory (`repo root` /
`packages/core`) or which invocation form (`pnpm exec prisma generate`,
`pnpm --filter @mymozhem/core run prisma:generate`) it was launched from — the check is based on
schema-file location, not CWD.

**Fix applied:** added `"prisma": "^7.6.0"` to `packages/core/package.json` `devDependencies`
(alongside the existing `@prisma/client` dependency), then ran `pnpm install`. This gives
`packages/core/node_modules/prisma` its own symlink as a sibling of
`packages/core/node_modules/@prisma/client`, satisfying the co-location check. This matches
Prisma's own generic guidance ("Install `prisma` as a development dependency and `@prisma/client`
for interacting with your database" — i.e. install both, together) and the pattern in Prisma's
own e2e monorepo test fixtures (`cd packages/db && pnpm exec prisma generate`), confirmed via
Context7 docs lookup. No models/multiSchema/output field were added; the schema.prisma file is
untouched from Step 1.

After the fix, both commands succeed:
```
$ DATABASE_URL='postgresql://u:p@localhost:5432/db' pnpm exec prisma validate
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from packages/core/prisma/schema.prisma.
The schema at packages/core/prisma/schema.prisma is valid 🚀

$ DATABASE_URL='postgresql://u:p@localhost:5432/db' pnpm exec prisma generate
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from packages/core/prisma/schema.prisma.
✔ Generated Prisma Client (v7.8.0) to ./node_modules/.pnpm/@prisma+client@7.8.0_.../node_modules/@prisma/client in 30ms
```
`DATABASE_URL` was a throwaway local placeholder used only for these two schema-only commands,
per the HARD CONSTRAINT — no DB was ever contacted (schema-only ops don't open a connection).

**allowBuilds gate: left untouched.** It was never the blocker — the schema-engine binary was
already present in `node_modules/.pnpm/@prisma+engines@7.8.0/...`; `prisma --version` and
`prisma validate`/`generate` never needed to fetch/build anything gated by `allowBuilds`.
`pnpm-workspace.yaml` was not modified.

### Step 4 — failing test written verbatim
`packages/core/src/prisma/prisma.service.spec.ts` created exactly as specified in the brief.

### Step 5 — RED confirmed
```
$ pnpm --filter @mymozhem/core test -- prisma.service
FAIL src/prisma/prisma.service.spec.ts
  ● Test suite failed to run
    src/prisma/prisma.service.spec.ts:1:31 - error TS2307: Cannot find module './prisma.service'
      or its corresponding type declarations.
Test Suites: 1 failed, 1 total
```
Matches the brief's expected RED exactly ("cannot find module `./prisma.service`").

### Step 7 — `index.ts` updated
```ts
export * from './config/config.schema';
export * from './prisma/prisma.service';
export * from './prisma/prisma.module';
```

---

## Step 6 / Step 8 — where it breaks

`PrismaService`/`PrismaModule` were written **verbatim** per the brief:

```ts
// packages/core/src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
```

```ts
// packages/core/src/prisma/prisma.module.ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Running `pnpm --filter @mymozhem/core test`:
```
FAIL src/prisma/prisma.service.spec.ts
  ● PrismaService.isHealthy › returns true when the query succeeds
    PrismaClientInitializationError: `PrismaClient` needs to be constructed with a non-empty,
    valid `PrismaClientOptions`:
        new PrismaClient({ ... })
      or
        constructor() { super({ ... }); }
      at new PrismaService (src/prisma/prisma.service.ts:5:8)
      at Object.<anonymous> (src/prisma/prisma.service.spec.ts:5:17)
  ● PrismaService.isHealthy › returns false when the query throws
    (same error)
Test Suites: 1 failed, 1 passed, 2 total
Tests:       2 failed, 4 passed, 6 total
```

Both `PrismaService` tests fail at `new PrismaService()` — **before** `$queryRaw` is ever
reached, so the `jest.spyOn(svc, '$queryRaw')` mocking never gets a chance to matter. The
config suite (Task 4) still passes (4 tests, unaffected).

### Root cause: confirmed, not an environment artifact

Reproduced independent of Jest/ts-jest:
```
$ node -e "
const { PrismaClient } = require('@prisma/client');
try { new PrismaClient(); console.log('OK'); }
catch (e) { console.log('THREW:', e.message.split('\n')[0]); }
"
THREW: `PrismaClient` needs to be constructed with a non-empty, valid `PrismaClientOptions`:
```

Traced into the shipped runtime (`.../@prisma/client/runtime/client.js`) and cross-checked
against Prisma's own docs (via Context7, `/prisma/prisma`):

- `PrismaClientOptions` is a **discriminated union**: `PrismaClientOptionsWithAdapter |
  PrismaClientOptionsWithAccelerateUrl` — one of `adapter` or `accelerateUrl` is **mandatory**,
  not optional. `datasourceUrl` (a schema-url override) is not a substitute; it doesn't satisfy
  the union.
- Prisma's own `AGENTS.md` states this plainly as a defining Prisma 7 change: *"Prisma 7
  introduces significant architectural changes, including the removal of the query engine
  concept and database URLs from schema files. Query execution is now handled by TypeScript
  using JavaScript drivers... there are no native binaries or library addons in the Prisma
  Client."*
- The classic pattern the brief's `schema.prisma` + zero-arg `new PrismaClient()` assumes
  (binary/library query engine reading `DATABASE_URL` straight from the datasource block) does
  not exist anymore in Prisma 7 GA. It applies uniformly to the whole 7.x line (this is
  described as *the* v7 architecture, not a late-minor regression), so pinning to the brief's
  exact `^7.6.0` floor would not avoid it.
- The only way to make `new PrismaClient()` (or `new PrismaService()`) succeed is to pass a
  driver adapter, e.g.:
  ```ts
  import { PrismaPg } from '@prisma/adapter-pg';
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });
  ```

### Why I stopped instead of "just fixing it"

Making the tests pass now requires **more than what the brief specifies**:
1. A new dependency (`@prisma/adapter-pg` and its `pg` peer, not currently in `packages/core`'s
   or the workspace's dependency graph).
2. A `PrismaService` constructor (the brief's verbatim version has none — it relies on the
   base class's zero-arg constructor working, which it no longer does), meaning I'd have to
   design where the connection string comes from (raw `process.env.DATABASE_URL`? threaded
   through Task 4's zod-validated config service? a constructor parameter?) — a real design
   decision that affects Task 6 (health endpoint DI) and Task 7 (real docker Postgres
   connectivity), not just this task's plumbing.
3. This is unlike the `allowBuilds` fork in the task instructions, which had an exact prescribed
   fallback action. There is no prescribed fallback for "Prisma 7 requires a driver adapter" —
   the brief's design note only discusses the `multiSchema` deviation, not this.

Per the task's own instruction ("If anything is ambiguous or a command fails in a way not
covered above, ask/escalate rather than guessing"), I stopped here rather than picking an
adapter package and constructor shape unilaterally.

### Recommendation (for whoever unblocks this)

- Add `@prisma/adapter-pg` (+ `pg`) to `packages/core`'s dependencies.
- Give `PrismaService` an explicit constructor that builds a `PrismaPg` adapter from a
  connection string and calls `super({ adapter })` — sourced from `process.env.DATABASE_URL`
  directly (simplest, keeps `new PrismaService()` zero-arg as the brief's test expects) or from
  a constructor parameter with a default (more testable, but changes the test file, which is
  supposed to stay verbatim per the brief).
- This is worth a short design-note addendum next to the existing `multiSchema` deviation note
  in the task-5 brief (or upstream in the design doc / a REQ-DEV-004-style flag), since it's a
  genuinely new fact about the target stack (ADR-006 names Prisma/Postgres but is silent on
  driver adapters) discovered during implementation — not a reason to relitigate ADR-006, just
  to record the concrete mechanism.

---

## Files changed so far (nothing committed)

```
 M packages/core/package.json     (+1: "prisma": "^7.6.0" devDependency)
 M packages/core/src/index.ts     (+2: prisma exports)
 M pnpm-lock.yaml                 (regenerated by pnpm install)
?? packages/core/prisma/schema.prisma
?? packages/core/src/prisma/prisma.service.ts
?? packages/core/src/prisma/prisma.module.ts
?? packages/core/src/prisma/prisma.service.spec.ts
?? prisma.config.ts
```

No generated client committed (it lives in `node_modules/.pnpm/.../@prisma/client`, gitignored,
as expected). Nothing under `.superpowers/` staged or touched except this report.
`pnpm-workspace.yaml` (`allowBuilds`) is untouched.

## Self-review against the checklist

- Completeness: schema.prisma, prisma.config.ts, test file — present & verbatim, working.
  `PrismaService`/`PrismaModule`/`index.ts` — present & verbatim, but **not passing** due to the
  blocker above.
- `prisma validate` + `prisma generate`: **succeed** (after the sanctioned co-location
  dependency fix).
- PrismaService tests: **failing**, both of them, at construction time — not the
  true/false-on-throw behavior the brief intends to exercise.
- Task 4 config tests: still passing (4/4).
- Discipline: no models, no multiSchema, no health-endpoint code, no `prisma migrate`/DB
  connection ever attempted.
- Commit: **not created** — GREEN was never reached, so Step 9 was not run.

## Concerns

1. Primary concern is the blocker above — needs an owner/architect call on the driver-adapter
   approach before Step 6 can actually pass.
2. Secondary, resolved concern: the pnpm/Prisma co-location constraint is a real, generalizable
   monorepo gotcha (not specific to this schema) — worth keeping in mind for any future package
   that generates a Prisma client (each such package will need its own `prisma` devDependency,
   not just a root one).

---

## Resolution (2026-07-16) — owner-approved Prisma 7 driver adapter

Owner unblocked with a decision: **Prisma 7 + driver adapter** (not a 6.x downgrade), within
ADR-006. Brief was amended (section "AMENDMENT (owner-approved, 2026-07-16) — Prisma 7 driver
adapter"), superseding the verbatim `PrismaService`. Finished per that amendment.

### Deps added (`packages/core/package.json`)
- `dependencies`: `@prisma/adapter-pg` `^7.6.0` (resolved to **7.8.0**, matches installed
  Prisma/@prisma/client 7.8.0) and `pg` `^8.13.0` (resolved to **8.22.0**).
- `devDependencies`: `@types/pg` `^8.11.0`; kept the `prisma` `^7.6.0` devDep (co-location fix).
- `pnpm install` clean; **no allowBuilds gate fired** on any newly-added package (`pg` did not
  trigger a build-script approval prompt). `pnpm-workspace.yaml` **untouched** — confirmed via
  `git diff --stat pnpm-workspace.yaml` (empty).

### Constructor change (`prisma.service.ts`)
Added the amendment's explicit constructor; `onModuleInit`/`onModuleDestroy`/`isHealthy` left
exactly as the brief's verbatim version; generator stays `prisma-client-js`; schema stays the
minimal no-models version.
```ts
import { PrismaPg } from '@prisma/adapter-pg';
// ...
constructor() {
  super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
}
```
Test file (`prisma.service.spec.ts`) kept **verbatim** — `new PrismaService()` zero-arg +
`jest.spyOn(svc, '$queryRaw').mock…`.

### Zero-arg-construct-without-connection assumption: HELD (verified empirically)
Independent `node -e` repro with `DATABASE_URL` deleted from env:
```
PrismaPg constructed OK with undefined connectionString (no throw, no connect)
PrismaClient constructed OK with adapter
no async connection error fired within 300ms
```
The pg Pool is lazy: constructing `new PrismaPg({ connectionString: undefined })` and
`new PrismaClient({ adapter })` neither throws at construction nor opens a socket. No placeholder
URL was needed for the tests, and the mocked `$queryRaw` means no real DB is ever contacted —
HARD CONSTRAINT preserved.

### TDD GREEN evidence
```
$ pnpm --filter @mymozhem/core test
PASS src/prisma/prisma.service.spec.ts
PASS src/config/config.schema.spec.ts
Test Suites: 2 passed, 2 total
Tests:       6 passed, 6 total
```
Both `PrismaService.isHealthy` tests pass (true when `$queryRaw` resolves, false when it
rejects); all 4 Task 4 config tests still pass. Pristine output (no warnings/errors).

### Other gates
- `prisma generate` (with throwaway `DATABASE_URL`, schema-only, no DB contact): still
  succeeds — `✔ Generated Prisma Client (v7.8.0)`.
- Guardrails: `pnpm run guardrails` →
  `OK — guardrail fired on: sdk → core import (dependency-cruiser)` /
  `OK — guardrail fired on: module-level mutable export (eslint)` /
  `All guardrails verified alive.`
- `pnpm --filter @mymozhem/core typecheck` and `lint`: both clean (no output).

### Commit
`332541b` — `feat(core): prisma driver-adapter wiring + readiness check (REQ-OPS-001/002; Prisma 7 adapter, owner-approved)`

```
 packages/core/package.json                      |   4 +
 packages/core/prisma/schema.prisma              |   7 ++
 packages/core/src/index.ts                      |   2 +
 packages/core/src/prisma/prisma.module.ts       |   8 ++
 packages/core/src/prisma/prisma.service.spec.ts |  15 +++
 packages/core/src/prisma/prisma.service.ts      |  28 +++++
 pnpm-lock.yaml                                  | 153 ++++++++++++++++++++++++
 prisma.config.ts                                |   8 ++
 8 files changed, 225 insertions(+)
```
Staged exactly `packages/core prisma.config.ts pnpm-lock.yaml` (no `pnpm-workspace.yaml` change
needed). Nothing under `.superpowers/` staged. Generated client not tracked (lives in gitignored
`node_modules`). Not pushed (per instructions).

### Self-review (final)
- schema.prisma (minimal, no models / no multiSchema), prisma.config.ts, PrismaService (adapter
  constructor + try/catch isHealthy), PrismaModule, index.ts exports, verbatim test — all
  present. `prisma validate`/`generate` succeed. All 6 tests green. Guardrails/typecheck/lint
  green.
- Discipline: no models, no multiSchema, no health-endpoint code (Task 6), no `prisma
  migrate`/DB connection ever run. Generator unchanged (`prisma-client-js`).
- allowBuilds: untouched throughout (never the blocker; no gate fired on the new deps either).
- Commit hygiene: `git show --stat` shows only intended paths; no generated client; nothing from
  `.superpowers/`.

### Concerns
- None blocking. Minor forward note (unchanged from before): the pnpm+Prisma co-location
  constraint means any *future* package that generates a Prisma client will need its own
  `prisma` devDep, not just a root one. Task 7 will be the first to exercise `PrismaPg` against
  a real (local docker) Postgres and confirm `onModuleInit` `$connect()` + a live `SELECT 1`
  end-to-end.
