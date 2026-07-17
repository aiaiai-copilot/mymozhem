# App/Manifest Registration Service — Implementation Plan (Phase 1, core-side)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the app/manifest **registration** service in `packages/core` — enforcement point #1 of the SDK-contract design §7 — as the first real core-side consumer of the SDK contract, and nothing else.

**Architecture:** A manifest crosses the SDK boundary as a serializable `AppManifest` (JSON Schema inside, already converted+guarded by the app's `defineApp`). The core **re-validates its form** (`appManifestSchema`, defense-in-depth) and checks that the **running** `CONTRACT_VERSION` satisfies the manifest's declared range (`assertContractRangeSatisfied`, REQ-CTR-004). Valid manifests populate an **immutable registry built once at boot** from the manifests compiled into this artifact (REQ-CORE-004) — no Prisma, no runtime endpoint. The registry exposes a single lookup, `getManifest(appId, manifestVersion)`.

**Tech Stack:** TypeScript 5.7 · NestJS 11 · zod 4 · Jest 29 (ts-jest) · pnpm 11 · turbo 2.

**Input design:** `docs/sessions/2026-07-18-app-registry-registration-design.md` (owner-approved 2026-07-18; three scope decisions and three micro-decisions confirmed in the brainstorm session).

---

## Global Constraints

Copied from the design, normative package v1.2, amendment v1.3, and CLAUDE.md. Every task implicitly includes these.

- **Code artifact is `packages/core/src/app-registry/` only** (+ two one-line edits to `packages/core/src/index.ts` and `apps/server/src/app.module.ts`). No Rooms, no `appSettings` write path, no event-commit, no projection, no Prisma table, no HTTP endpoint (design §1).
- **The core does NOT re-run the conversion guard.** The manifest arrives already JSON Schema; the guard is inherently authoring-side (`defineApp`). The core's distinctive check is `assertContractRangeSatisfied` (design §3).
- **No module-level mutable state** — the registry is built once at construction and frozen; `let`/`var` at program level is an ESLint error (REQ-CORE-004).
- **Typed error codes only from the SDK's closed set** — no new error code is introduced (design §4, micro-decision 2). `MANIFEST_INVALID`, `CONTRACT_VERSION_INCOMPATIBLE` are the two used here. Never forward `error.message` outward (REQ-SEC-006).
- **A duplicate `(appId, manifestVersion)` at boot is a fatal misconfiguration** → a plain `Error` that crashes startup, not a typed `ContractError` (design §4, micro-decision 1).
- **Apps reach the core only through the package entrypoint `@mymozhem/core`**, not its `src` internals — so anything `apps/server` needs must be re-exported from `packages/core/src/index.ts` (dependency-cruiser rule `apps-only-through-core-entrypoint`, ADR-002, REQ-DEV-001).
- **`core → sdk` is allowed** (sdk is the leaf everyone may depend on); `@mymozhem/sdk` is already declared in `packages/core/package.json`. No `.dependency-cruiser.cjs` change is needed.
- **Fixtures**: reuse the SDK's shipped `validManifests` / `invalidManifestCases`; registration-specific negatives (incompatible range, duplicate key) are constructed inline in the spec (REQ-CTR-005).
- **ADR-001…011 are binding**; deviation only via a new ADR in `docs/adr/` before merge (REQ-DEV-004).
- **Session artifacts live in `docs/sessions/`** (REQ-DEV-003). **One lockfile**, pnpm only (REQ-DEV-002). Node ≥ 24.

---

## Requirements this plan closes

- **REQ-CTR-004** — registration-time compatibility check: the running `CONTRACT_VERSION` must satisfy the manifest's declared `contractRange`, else `CONTRACT_VERSION_INCOMPATIBLE`. First consumer of `assertContractRangeSatisfied`.
- **REQ-CORE-004** — build-once-at-boot immutable registry; no mutable module-level state.
- **REQ-CTR-005** — valid/invalid fixtures at the registration surface.
- **REQ-DEV-001 / ADR-002** — new module under boundary-check from its first commit; core↔module only through the SDK contract.

**Constrained but NOT closed here** (runtime enforcement belongs to later phase-1 plans, per design §7): REQ-CTR-008/009 (per-type visibility is *stored and retrievable*; commit-time rejection is the event task), REQ-RT-004 (registry is *keyed* by `(appId, manifestVersion)`; pinning at `ACTIVE` is the Rooms task), REQ-CORE-007, REQ-DEV-007.

---

## File Structure

```
packages/core/src/
├── index.ts                              # MODIFY: + export the four app-registry files
└── app-registry/
    ├── app-registry.ts                   # CREATE: registerManifest() + buildAppRegistry() + AppRegistry type   [Task 1]
    ├── app-registry.spec.ts              # CREATE: pure-logic unit tests                                        [Task 1]
    ├── app-registry.tokens.ts            # CREATE: APP_MANIFESTS DI token                                       [Task 2]
    ├── app-registry.service.ts           # CREATE: @Injectable() wrapper over the immutable registry            [Task 2]
    ├── app-registry.module.ts            # CREATE: @Module providing APP_MANIFESTS=[] + AppRegistryService      [Task 2]
    └── app-registry.service.spec.ts      # CREATE: service + module (Nest) tests                                [Task 2]
apps/server/src/
└── app.module.ts                         # MODIFY: import AppRegistryModule                                     [Task 2]
```

> **Note (minor refinement of design §5):** the design listed a single `app-registry.spec.ts` "pure logic + service construction". This plan splits the service/module tests into `app-registry.service.spec.ts` so Task 1 and Task 2 each own an independent test file and test cycle. Same coverage, cleaner per-task boundary.

**Commands** (run from repo root):
- Single core spec: `pnpm --filter @mymozhem/core exec jest src/app-registry/<file>.spec.ts`
- Single test by name: append `-t "<name>"`
- Full core suite: `pnpm --filter @mymozhem/core test`
- Monorepo gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm boundary-check && pnpm guardrails`

---

## Task 1: Pure registration logic

**Files:**
- Create: `packages/core/src/app-registry/app-registry.ts`
- Test: `packages/core/src/app-registry/app-registry.spec.ts`

**Interfaces:**
- Consumes (from `@mymozhem/sdk`): `appManifestSchema`, `assertContractRangeSatisfied(range: string): void`, `ContractError` (has `.code: ContractErrorCode`), `type AppManifest` (`{ appId: string; manifestVersion: number; contractRange: string; appSettings; events }`), and fixtures `validManifests: AppManifest[]`, `invalidManifestCases: { name: string; value: unknown }[]`, `CONTRACT_VERSION: string`.
- Produces (for Task 2 and later plans):
  - `registerManifest(input: unknown): AppManifest` — throws `ContractError('MANIFEST_INVALID')` or `ContractError('CONTRACT_VERSION_INCOMPATIBLE')`.
  - `type AppRegistry = { getManifest(appId: string, manifestVersion: number): AppManifest | undefined }`.
  - `buildAppRegistry(manifests: readonly unknown[]): AppRegistry` — throws a per-manifest `ContractError`, or a plain `Error` on a duplicate `(appId, manifestVersion)`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/app-registry/app-registry.spec.ts`:

```ts
import {
  ContractError,
  validManifests,
  invalidManifestCases,
  CONTRACT_VERSION,
} from '@mymozhem/sdk';
import { registerManifest, buildAppRegistry } from './app-registry';

// Returns the thrown ContractError's `code`, or the raw error for a non-ContractError,
// or undefined if nothing threw. Keeps the error-code assertions terse.
const catchCode = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return err instanceof ContractError ? err.code : err;
  }
  return undefined;
};

describe('registerManifest', () => {
  it('returns the parsed manifest for a valid input', () => {
    const manifest = validManifests[0];
    expect(registerManifest(manifest)).toEqual(manifest);
  });

  it.each(invalidManifestCases)(
    'rejects a structurally invalid manifest as MANIFEST_INVALID: $name',
    ({ value }) => {
      expect(catchCode(() => registerManifest(value))).toBe('MANIFEST_INVALID');
    },
  );

  it('rejects an unbounded-above contract range as MANIFEST_INVALID', () => {
    const manifest = { ...validManifests[0], contractRange: '>=1.0.0' };
    expect(catchCode(() => registerManifest(manifest))).toBe('MANIFEST_INVALID');
  });

  it('rejects a range excluding the running version as CONTRACT_VERSION_INCOMPATIBLE', () => {
    const manifest = { ...validManifests[0], contractRange: '^2.0.0' };
    expect(catchCode(() => registerManifest(manifest))).toBe('CONTRACT_VERSION_INCOMPATIBLE');
  });

  it('accepts a bounded range that includes the running version', () => {
    const manifest = { ...validManifests[0], contractRange: `^${CONTRACT_VERSION}` };
    expect(registerManifest(manifest).contractRange).toBe(`^${CONTRACT_VERSION}`);
  });
});

describe('buildAppRegistry', () => {
  it('resolves every registered manifest by (appId, manifestVersion)', () => {
    const v1 = validManifests[0];
    const v2 = { ...v1, manifestVersion: v1.manifestVersion + 1 };
    const registry = buildAppRegistry([v1, v2]);
    expect(registry.getManifest(v1.appId, v1.manifestVersion)).toEqual(v1);
    expect(registry.getManifest(v2.appId, v2.manifestVersion)).toEqual(v2);
  });

  it('returns undefined for an unknown key', () => {
    const registry = buildAppRegistry([validManifests[0]]);
    expect(registry.getManifest('no-such-app', 999)).toBeUndefined();
  });

  it('builds an empty registry from an empty list', () => {
    const registry = buildAppRegistry([]);
    const { appId, manifestVersion } = validManifests[0];
    expect(registry.getManifest(appId, manifestVersion)).toBeUndefined();
  });

  it('throws a fatal plain Error (not a ContractError) on a duplicate key', () => {
    const dup = [validManifests[0], { ...validManifests[0] }];
    let caught: unknown;
    try {
      buildAppRegistry(dup);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(ContractError);
    expect((caught as Error).message).toMatch(/duplicate manifest registration/);
  });

  it('propagates a per-manifest ContractError when a manifest in the list is invalid', () => {
    expect(catchCode(() => buildAppRegistry([invalidManifestCases[0].value]))).toBe(
      'MANIFEST_INVALID',
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @mymozhem/core exec jest src/app-registry/app-registry.spec.ts`
Expected: FAIL — `Cannot find module './app-registry'` (implementation not written yet).

- [ ] **Step 3: Write the minimal implementation**

Create `packages/core/src/app-registry/app-registry.ts`:

```ts
import {
  appManifestSchema,
  assertContractRangeSatisfied,
  ContractError,
  type AppManifest,
} from '@mymozhem/sdk';

// Validate a manifest crossing the SDK boundary and return the trusted snapshot.
// The manifest arrives already converted to JSON Schema by the app's defineApp call,
// so the core re-validates its FORM (defense-in-depth) and checks that the RUNNING
// contract version satisfies the declared range (REQ-CTR-004). It does NOT re-run the
// conversion guard — there is no zod left to convert (design §3).
export const registerManifest = (input: unknown): AppManifest => {
  const parsed = appManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ContractError('MANIFEST_INVALID', parsed.error.message);
  }
  assertContractRangeSatisfied(parsed.data.contractRange);
  return parsed.data;
};

export type AppRegistry = {
  getManifest(appId: string, manifestVersion: number): AppManifest | undefined;
};

const registryKey = (appId: string, manifestVersion: number): string =>
  `${appId}@${manifestVersion}`;

// Build the immutable registry once, from the manifests compiled into this artifact.
// REQ-CORE-004: constructed once and frozen — no mutable module-level state. A bad
// manifest throws (fail-closed). A duplicate (appId, manifestVersion) is a compiled-in
// misconfiguration, so it crashes assembly with a plain Error rather than a typed
// ContractError (design §4, micro-decision 1).
export const buildAppRegistry = (manifests: readonly unknown[]): AppRegistry => {
  const byKey = new Map<string, AppManifest>();
  for (const input of manifests) {
    const manifest = registerManifest(input);
    const key = registryKey(manifest.appId, manifest.manifestVersion);
    if (byKey.has(key)) {
      throw new Error(`App registry: duplicate manifest registration for ${key}`);
    }
    byKey.set(key, manifest);
  }
  return Object.freeze({
    getManifest: (appId: string, manifestVersion: number): AppManifest | undefined =>
      byKey.get(registryKey(appId, manifestVersion)),
  });
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @mymozhem/core exec jest src/app-registry/app-registry.spec.ts`
Expected: PASS — all `registerManifest` and `buildAppRegistry` tests green.

- [ ] **Step 5: Typecheck + lint the package**

Run: `pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/app-registry/app-registry.ts packages/core/src/app-registry/app-registry.spec.ts
git commit -m "feat(core): app-registry manifest registration logic (REQ-CTR-004, REQ-CORE-004)"
```

---

## Task 2: NestJS wiring + phase-2 seam

**Files:**
- Create: `packages/core/src/app-registry/app-registry.tokens.ts`
- Create: `packages/core/src/app-registry/app-registry.service.ts`
- Create: `packages/core/src/app-registry/app-registry.module.ts`
- Test: `packages/core/src/app-registry/app-registry.service.spec.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/server/src/app.module.ts`

**Interfaces:**
- Consumes (from Task 1): `buildAppRegistry`, `type AppRegistry`. From `@mymozhem/sdk`: `type AppManifest`, `ContractError`, fixtures `validManifests`, `invalidManifestCases`.
- Produces:
  - `APP_MANIFESTS` — DI token (a `symbol`) for the compiled-in manifests.
  - `AppRegistryService` — `@Injectable()` with `getManifest(appId: string, manifestVersion: number): AppManifest | undefined`, registry built in the constructor from the injected `APP_MANIFESTS`.
  - `AppRegistryModule` — provides `APP_MANIFESTS = []` and `AppRegistryService`, exports `AppRegistryService`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/app-registry/app-registry.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ContractError, validManifests, invalidManifestCases } from '@mymozhem/sdk';
import { AppRegistryService } from './app-registry.service';
import { AppRegistryModule } from './app-registry.module';

describe('AppRegistryService', () => {
  it('builds its registry from the injected manifests', () => {
    const { appId, manifestVersion } = validManifests[0];
    const svc = new AppRegistryService([validManifests[0]]);
    expect(svc.getManifest(appId, manifestVersion)).toEqual(validManifests[0]);
  });

  it('fails construction (boot) when an injected manifest is invalid', () => {
    expect(() => new AppRegistryService([invalidManifestCases[0].value])).toThrow(ContractError);
  });
});

describe('AppRegistryModule', () => {
  it('provides AppRegistryService with an empty registry by default', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppRegistryModule],
    }).compile();
    const svc = moduleRef.get(AppRegistryService);
    const { appId, manifestVersion } = validManifests[0];
    expect(svc.getManifest(appId, manifestVersion)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @mymozhem/core exec jest src/app-registry/app-registry.service.spec.ts`
Expected: FAIL — `Cannot find module './app-registry.service'`.

- [ ] **Step 3: Create the DI token**

Create `packages/core/src/app-registry/app-registry.tokens.ts`:

```ts
// DI token for the manifests compiled into this artifact. Empty in phase 1 — this is
// the seam where phase-2 app-modules contribute their defineApp() manifests (design §5).
export const APP_MANIFESTS = Symbol('APP_MANIFESTS');
```

- [ ] **Step 4: Create the service**

Create `packages/core/src/app-registry/app-registry.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { AppManifest } from '@mymozhem/sdk';
import { buildAppRegistry, type AppRegistry } from './app-registry';
import { APP_MANIFESTS } from './app-registry.tokens';

@Injectable()
export class AppRegistryService {
  private readonly registry: AppRegistry;

  constructor(@Inject(APP_MANIFESTS) manifests: readonly unknown[]) {
    // Built once at construction (boot); immutable thereafter (REQ-CORE-004). A bad
    // manifest throws here and fails startup — fail-closed.
    this.registry = buildAppRegistry(manifests);
  }

  getManifest(appId: string, manifestVersion: number): AppManifest | undefined {
    return this.registry.getManifest(appId, manifestVersion);
  }
}
```

- [ ] **Step 5: Create the module**

Create `packages/core/src/app-registry/app-registry.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AppRegistryService } from './app-registry.service';
import { APP_MANIFESTS } from './app-registry.tokens';

@Module({
  providers: [
    // Empty seam: phase-2 app-modules replace this with their manifests (design §5).
    { provide: APP_MANIFESTS, useValue: [] },
    AppRegistryService,
  ],
  exports: [AppRegistryService],
})
export class AppRegistryModule {}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @mymozhem/core exec jest src/app-registry/app-registry.service.spec.ts`
Expected: PASS — service builds from the token, fails construction on a bad manifest, module provides an empty registry.

- [ ] **Step 7: Export from the package entrypoint**

Modify `packages/core/src/index.ts` — append these four lines (apps may only import from `@mymozhem/core`, so the module must be re-exported):

```ts
export * from './app-registry/app-registry';
export * from './app-registry/app-registry.tokens';
export * from './app-registry/app-registry.service';
export * from './app-registry/app-registry.module';
```

- [ ] **Step 8: Wire the module into the server**

Modify `apps/server/src/app.module.ts` to its full new contents:

```ts
import { Module } from '@nestjs/common';
import { AppRegistryModule, HealthModule, PrismaModule } from '@mymozhem/core';

@Module({
  imports: [PrismaModule, HealthModule, AppRegistryModule],
})
export class AppModule {}
```

- [ ] **Step 9: Run the full monorepo gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm boundary-check && pnpm guardrails`
Expected: all green — including `boundary-check` reporting no dependency violations (the new `core → sdk` edge is allowed) and `guardrails` confirming the enforcers are alive.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/app-registry/app-registry.tokens.ts packages/core/src/app-registry/app-registry.service.ts packages/core/src/app-registry/app-registry.module.ts packages/core/src/app-registry/app-registry.service.spec.ts packages/core/src/index.ts apps/server/src/app.module.ts
git commit -m "feat(core): wire AppRegistryModule with empty phase-2 manifest seam (REQ-CORE-004, ADR-002)"
```

---

## Exit criteria

- `registerManifest` rejects a structurally invalid manifest (`MANIFEST_INVALID`), an unbounded-above range (`MANIFEST_INVALID`), and a range excluding the running version (`CONTRACT_VERSION_INCOMPATIBLE`); accepts a bounded compatible range.
- `buildAppRegistry` resolves each manifest by `(appId, manifestVersion)`, returns `undefined` for unknown keys, crashes on a duplicate key with a plain `Error`, and propagates per-manifest `ContractError`s.
- `AppRegistryService` builds its registry once at construction, fails boot on a bad manifest, and is provided with an empty registry by `AppRegistryModule`.
- The server boots with `AppRegistryModule` imported; all six monorepo gates are green (typecheck, lint, test, build, boundary-check, guardrails).

## What this plan deliberately does NOT build (design §1, §7)

No Rooms; no `appSettings` write/validation path (point #2); no `DRAFT→ACTIVE` pin (REQ-RT-004 enforcement); no event-commit pipeline; no projection read; no composed-event-type index (composable later from `resolveTypeOwner` + `getManifest`); no Prisma table / migration; no HTTP or runtime registration endpoint. Each is a later phase-1 plan or a Rooms dependency.
