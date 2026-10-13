# Task 6 report: Health module, server composition root, and e2e boot

## What was implemented

Following the brief verbatim (steps 1–9):

1. **`packages/core/src/health/health.controller.ts`** — `HealthController` with `GET /health/live` (returns `{status:'ok'}`) and `GET /health/ready` (delegates to `PrismaService.isHealthy()`; throws `ServiceUnavailableException` → 503 when unhealthy, else returns `{status:'ok', db:true}`). Thin transport wiring only — no business logic in the controller (REQ-CORE-006).
2. **`packages/core/src/health/health.module.ts`** — `HealthModule` importing `PrismaModule`, registering `HealthController`.
3. **`packages/core/src/index.ts`** — appended two export lines for the health controller/module (core's public entrypoint now surfaces `HealthController`, `HealthModule` alongside existing `config`/`prisma` exports).
4. **`apps/server/package.json`, `tsconfig.json`, `jest.config.js`** — new `@mymozhem/server` package (first `apps/*` package), depends on `@mymozhem/core` via `workspace:*`, NestJS 11 + `@nestjs/platform-fastify`, jest 29 + ts-jest, TS 5.7 — all verbatim from the brief.
5. **`apps/server/src/app.module.ts`** — `AppModule` importing `PrismaModule` and `HealthModule` from `@mymozhem/core` (via the package entrypoint only, no deep imports into core internals).
6. **`apps/server/src/main.ts`** — `bootstrap()` that calls `loadConfig(process.env)` **before** `NestFactory.create(...)`, then `app.listen(config.PORT, '0.0.0.0')`.
7. **`apps/server/test/health.e2e-spec.ts`** — e2e test using `Test.createTestingModule({imports:[AppModule]}).overrideProvider(PrismaService).useValue(prismaStub)`, boots a real Fastify instance via `app.inject(...)`, asserts the three health-endpoint behaviors. The stub means the real `PrismaService`/pg adapter is never constructed and no DB is contacted.

No other routes, modules, or scaffolding were added — nothing beyond health + composition root + the one e2e test.

## TDD evidence

**RED** — Step 6, run before `AppModule`/`main.ts` existed:

```
$ pnpm --filter @mymozhem/server test
FAIL test/health.e2e-spec.ts
  ● Test suite failed to run
    test/health.e2e-spec.ts:3:31 - error TS2307: Cannot find module '@mymozhem/core' or its corresponding type declarations.
    test/health.e2e-spec.ts:4:27 - error TS2307: Cannot find module '../src/app.module' or its corresponding type declarations.
Test Suites: 1 failed, 1 total
Tests:       0 total
```

Why it failed exactly as expected: `../src/app.module` did not exist yet (Step 7 not yet done). The additional `@mymozhem/core` resolution error is because core's `dist/` hadn't been built yet at that point in the sequence — consistent with the brief's Step 8, which builds core immediately before the (now-passing) e2e run. Both failure modes disappear once Steps 7–8 are done, so this is the expected RED, not a spurious one.

**GREEN** — Step 8, after implementing `AppModule`/`main.ts` and building core:

```
$ pnpm --filter @mymozhem/core build
$ tsc -p tsconfig.json
(dist/health/health.controller.{js,d.ts}, dist/health/health.module.{js,d.ts} emitted)

$ pnpm --filter @mymozhem/server test
PASS test/health.e2e-spec.ts
  Health (e2e)
    ✓ GET /health/live → 200 ok (7 ms)
    ✓ GET /health/ready → 200 when DB healthy (1 ms)
    ✓ GET /health/ready → 503 when DB down
Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
```

## Regression checks

```
$ pnpm --filter @mymozhem/core test
PASS src/prisma/prisma.service.spec.ts
PASS src/config/config.schema.spec.ts
Test Suites: 2 passed, 2 total
Tests:       6 passed, 6 total

$ pnpm --filter @mymozhem/sdk test
PASS src/events/log-event.contract.spec.ts
Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total

$ pnpm --filter @mymozhem/server typecheck   → clean (tsc --noEmit, no output)
$ pnpm --filter @mymozhem/server lint        → clean (eslint src, no output)
$ pnpm --filter @mymozhem/core lint          → clean (eslint src, no output)
```

All prior suites remain green; the new package type-checks and lints clean.

## Bootstrap ordering confirmation

`apps/server/src/main.ts`, lines 7–13:

```ts
async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);          // line 8 — BEFORE NestFactory.create
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  await app.listen(config.PORT, '0.0.0.0');
}
```

`loadConfig(process.env)` executes at line 8, strictly before `NestFactory.create(...)` at line 9 — matches the hard requirement carried from Task 5 review. Not reordered or deferred.

## HARD CONSTRAINT compliance (no real DB)

The e2e test overrides `PrismaService` with `prismaStub` (`isHealthy`/`onModuleInit`/`onModuleDestroy` as `jest.fn()`) via `.overrideProvider(PrismaService).useValue(prismaStub)`. The real `PrismaService` (pg adapter) was never constructed during this task. No database was stood up, no `prisma migrate`/`db push` was run, `main.ts` was never executed against a real DB — only imported/compiled via the composition-root code path exercised by the e2e test's DI override.

## Guardrails

```
$ pnpm run guardrails
OK   — guardrail fired on: sdk → core import (dependency-cruiser)
OK   — guardrail fired on: module-level mutable export (eslint)
All guardrails verified alive.

$ pnpm exec depcruise apps packages --config .dependency-cruiser.cjs
✔ no dependency violations found (50 modules, 71 dependencies cruised)
```

Boundary stays clean with `apps/server` present. `apps/server` imports `@mymozhem/core` only via its package entrypoint (`import { HealthModule, PrismaModule } from '@mymozhem/core'` in `app.module.ts`; `import { loadConfig } from '@mymozhem/core'` in `main.ts`; `import { PrismaService } from '@mymozhem/core'` in the e2e test) — no deep imports into `packages/core/src/**` from outside the package.

`pnpm-workspace.yaml` already listed `apps/*` as a workspace glob, so no workspace-config change was needed; `pnpm install` (Step 4) linked `@mymozhem/server` → `@mymozhem/core` via symlink (`node_modules/@mymozhem/core -> ../../../../packages/core`) without further changes.

## `git show --stat HEAD`

```
commit 59dfad4348009af4ddbb76453ac5cb01bc28fc46
    feat: health endpoints + NestJS/Fastify composition root (REQ-OPS-001, REQ-CORE-006)

 apps/server/jest.config.js                    |   6 +
 apps/server/package.json                      |  29 ++
 apps/server/src/app.module.ts                 |   7 +
 apps/server/src/main.ts                       |  16 ++
 apps/server/test/health.e2e-spec.ts           |  42 +++
 apps/server/tsconfig.json                     |   5 +
 packages/core/src/health/health.controller.ts |  21 ++
 packages/core/src/health/health.module.ts     |   9 +
 packages/core/src/index.ts                    |   2 +
 pnpm-lock.yaml                                | 396 ++++++++++++++++++++++++++
 10 files changed, 533 insertions(+)
```

Only `packages/core/*`, `apps/server/*`, and `pnpm-lock.yaml` changed. Nothing from `.superpowers/` was staged (verified with `git add -n` dry-run before staging).

## Files changed

- `packages/core/src/health/health.controller.ts` (new)
- `packages/core/src/health/health.module.ts` (new)
- `packages/core/src/index.ts` (modified — 2 new export lines)
- `apps/server/package.json` (new)
- `apps/server/tsconfig.json` (new)
- `apps/server/jest.config.js` (new)
- `apps/server/src/app.module.ts` (new)
- `apps/server/src/main.ts` (new)
- `apps/server/test/health.e2e-spec.ts` (new)
- `pnpm-lock.yaml` (updated by `pnpm install`)

## Self-review findings

- Completeness: all listed artifacts present, verbatim from the brief (byte-for-byte, no deviations). 3/3 e2e assertions pass.
- Ordering: `loadConfig` before `NestFactory.create` confirmed by direct read of `main.ts`.
- Discipline: no forward scaffolding — only health endpoints + composition root + one e2e test. `AppModule` imports exactly `PrismaModule` and `HealthModule`, nothing else. `HealthController` contains no business logic — it only calls `prisma.isHealthy()` and maps the boolean to an HTTP response/exception.
- Guardrails: green, both before commit and re-verified against the full `apps`+`packages` tree with `depcruise` directly.
- Commit hygiene: `git show --stat` confirms only the expected 10 files; no `.superpowers/`, no `dist/`, no `node_modules/`.
- Test output: pristine — no warnings, no console noise, no flakiness observed across two consecutive runs (before and after commit checks).

## Concerns

None. The task's hard constraints (no real DB, loadConfig-before-create ordering) were followed exactly as specified, and all regression suites (`core`, `sdk`) plus the new `server` suite pass. Guardrails remain enforcing with the new `apps/server` package present.
