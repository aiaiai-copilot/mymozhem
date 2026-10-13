# Task 2 Report: NestJS wiring + phase-2 seam

## Status: DONE

Note: an older `task-2-report.md` (dated 2026-07-16, describing a different
"Task 2 — SDK package and first contract schema") previously occupied this
path from an earlier plan iteration/numbering. This report replaces it and
documents the current Task 2 as briefed in
`.superpowers/sdd/task-2-brief.md` ("NestJS wiring + phase-2 seam"), executed
on branch `phase-1-app-registry-registration` with Task 1
(`packages/core/src/app-registry/app-registry.ts`) already committed.

## What was implemented

Following the brief exactly, I added the NestJS packaging around the pure
`app-registry.ts` logic from Task 1:

1. **`packages/core/src/app-registry/app-registry.tokens.ts`** (new) —
   exports `APP_MANIFESTS`, a `Symbol('APP_MANIFESTS')` DI token for the
   compiled-in manifests. Comment marks it as the phase-2 seam.
2. **`packages/core/src/app-registry/app-registry.service.ts`** (new) —
   `@Injectable() AppRegistryService`. Constructor takes
   `@Inject(APP_MANIFESTS) manifests: readonly unknown[]` and calls
   `buildAppRegistry(manifests)` once, storing the result in
   `private readonly registry`. `getManifest(appId, manifestVersion)`
   delegates to the built registry. No module-level mutable state — the
   registry is built inside the constructor (REQ-CORE-004).
3. **`packages/core/src/app-registry/app-registry.module.ts`** (new) —
   `@Module()` providing `{ provide: APP_MANIFESTS, useValue: [] }` (the
   empty phase-2 seam) and `AppRegistryService`; exports `AppRegistryService`.
4. **`packages/core/src/app-registry/app-registry.service.spec.ts`** (new,
   written first per TDD) — verbatim from the brief: three specs covering
   (a) the service builds a registry from injected manifests, (b)
   construction throws `ContractError` on an invalid injected manifest, (c)
   `AppRegistryModule` provides `AppRegistryService` with an empty registry
   via `@nestjs/testing`'s `Test.createTestingModule`.
5. **`packages/core/src/index.ts`** (modified) — appended four re-exports so
   apps only reach these through the `@mymozhem/core` package entrypoint:
   ```ts
   export * from './app-registry/app-registry';
   export * from './app-registry/app-registry.tokens';
   export * from './app-registry/app-registry.service';
   export * from './app-registry/app-registry.module';
   ```
6. **`apps/server/src/app.module.ts`** (modified) — now imports
   `AppRegistryModule` (alongside `HealthModule`, `PrismaModule`) from
   `@mymozhem/core` and adds it to `AppModule`'s `imports` array.

No changes were made to `app-registry.ts` or `app-registry.spec.ts` (Task 1
files), per instructions.

## TDD evidence

### RED (Step 2)

Command: `pnpm --filter @mymozhem/core exec jest src/app-registry/app-registry.service.spec.ts`

```
FAIL src/app-registry/app-registry.service.spec.ts
  ● Test suite failed to run

    src/app-registry/app-registry.service.spec.ts:3:36 - error TS2307: Cannot find module './app-registry.service' or its corresponding type declarations.

    3 import { AppRegistryService } from './app-registry.service';
                                          ~~~~~~~~~~~~~~~~~~~~~~~~
    src/app-registry/app-registry.service.spec.ts:4:35 - error TS2307: Cannot find module './app-registry.module' or its corresponding type declarations.

    4 import { AppRegistryModule } from './app-registry.module';
                                        ~~~~~~~~~~~~~~~~~~~~~~~

Test Suites: 1 failed, 1 total
Tests:       0 total
```

Matches the brief's expected failure exactly (`Cannot find module
'./app-registry.service'`).

### GREEN (Step 6)

Same command, after creating the token, service, and module:

```
PASS src/app-registry/app-registry.service.spec.ts
  AppRegistryService
    ✓ builds its registry from the injected manifests (2 ms)
    ✓ fails construction (boot) when an injected manifest is invalid (2 ms)
  AppRegistryModule
    ✓ provides AppRegistryService with an empty registry by default (3 ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
```

## Full gate results (Step 9)

Command:
`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm boundary-check && pnpm guardrails`

All six gates green, run as a single chained command (each only ran because
the prior one succeeded):

- **typecheck** — `turbo run typecheck`: 5/5 tasks successful (sdk, core, server).
- **lint** — `turbo run lint`: 3/3 tasks successful (sdk, core, server), no errors.
- **test** — `turbo run test`: 5/5 tasks successful.
  - `@mymozhem/sdk:test` — 10 suites, 142 tests passed.
  - `@mymozhem/core:test` — 4 suites, 28 tests passed (includes
    `app-registry.spec.ts` from Task 1 and the new
    `app-registry.service.spec.ts`).
  - `@mymozhem/server:test` — 1 suite, 3 tests passed (health e2e, unaffected).
- **build** — `turbo run build`: 3/3 tasks successful (sdk, core, server all
  compile, including the server now importing `AppRegistryModule`).
- **boundary-check** — `depcruise apps packages --config .dependency-cruiser.cjs`:
  `✔ no dependency violations found (141 modules, 283 dependencies cruised)`.
  The new `core → sdk` edge (via `app-registry.service.ts` importing
  `@mymozhem/sdk`, and the server importing `AppRegistryModule` from
  `@mymozhem/core`, not from core's `src` internals) produced no violations.
- **guardrails** — `node scripts/verify-guardrails.mjs`:
  ```
  OK   — guardrail fired on: sdk → core import (dependency-cruiser)
  OK   — guardrail fired on: module-level mutable export (eslint)
  OK   — guardrail fired on: apps → core src-internals import (dependency-cruiser)

  All guardrails verified alive.
  ```

## Files changed

- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/app-registry/app-registry.tokens.ts` (new)
- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/app-registry/app-registry.service.ts` (new)
- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/app-registry/app-registry.module.ts` (new)
- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/app-registry/app-registry.service.spec.ts` (new)
- `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/index.ts` (modified — 4 lines appended)
- `/Users/alexanderlapygin/Projects/mymozhem/apps/server/src/app.module.ts` (modified — imports and wires `AppRegistryModule`)

## Self-review

- [x] All four new files created exactly as the brief specifies (token, service, module, spec).
- [x] `index.ts` re-exports the four app-registry files (`app-registry`,
  `app-registry.tokens`, `app-registry.service`, `app-registry.module`) —
  confirmed by reading the final file.
- [x] `app.module.ts` imports `AppRegistryModule` from `@mymozhem/core` (not
  from any `src` internal path) and adds it to the `imports` array alongside
  `PrismaModule`, `HealthModule`.
- [x] The service builds its registry inside the constructor
  (`this.registry = buildAppRegistry(manifests)`) — no module-level
  `let`/`var`. Grepped for `^let|^var` across the three new non-spec files:
  no matches (REQ-CORE-004 satisfied).
- [x] The `APP_MANIFESTS` provider in `AppRegistryModule` is
  `{ provide: APP_MANIFESTS, useValue: [] }` — the empty phase-2 seam, no
  real manifests added.
- [x] All six gates green (typecheck, lint, test, build, boundary-check,
  guardrails) — full output above.
- [x] Test output pristine — no warnings, no `console.error`/`console.warn`
  noise in any suite.
- [x] Committed with the brief's exact message:
  `feat(core): wire AppRegistryModule with empty phase-2 manifest seam (REQ-CORE-004, ADR-002)`.

## Concerns

None. The implementation followed the brief verbatim (code, file paths,
commands, commit message) with no deviations required. No new error codes
were introduced; the closed SDK error set (`ContractError`) is reused as-is.
The `APP_MANIFESTS` seam remains empty (`[]`), consistent with "do not
scaffold for absent apps." Boundary-check confirms apps still only reach the
core through its package entrypoint, and the new `core → sdk` edge is an
allowed dependency direction.

## Commit

`192d38b` — `feat(core): wire AppRegistryModule with empty phase-2 manifest seam (REQ-CORE-004, ADR-002)`
(6 files changed, 68 insertions(+), 2 deletions(-))
