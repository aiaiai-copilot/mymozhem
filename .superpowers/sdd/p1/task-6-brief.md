## Task 6: Contract version and range satisfaction

**Files:**
- Create: `packages/sdk/src/contract-version.ts`, `packages/sdk/src/contract-version.contract.spec.ts`
- Modify: `packages/sdk/package.json` (version + `semver` dependency), `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `CONTRACT_VERSION: string`, `isContractRangeSatisfied(range: string): boolean`, `assertContractRangeSatisfied(range: string): void`.
- Consumes: `ContractError` (Task 2).

> **Design note (version number, recorded for review):** `CONTRACT_VERSION` starts at **`1.0.0`**, and `packages/sdk/package.json` moves from `0.0.0` to match, because REQ-CTR-004 states «Версия SDK = версия контракта». `1.0.0` rather than `0.1.0` so that caret ranges behave as authors expect — under semver, `^0.1.0` admits only patches, which would make every additive contract change look breaking to a manifest. Publishing 1.0.0 is not a stability claim: it is the axis on which REQ-CTR-004 compatibility is computed, and breaking changes go to 2.0.0. `@mymozhem/core` and `@mymozhem/server` stay at `0.0.0` — their versions carry no contract meaning.

- [ ] **Step 1: Add the semver dependency**

Run: `pnpm --filter @mymozhem/sdk add semver && pnpm --filter @mymozhem/sdk add -D @types/semver`
Expected: completes; `packages/sdk/package.json` gains `"semver"` under `dependencies` and `"@types/semver"` under `devDependencies`; the only lockfile changed is the root `pnpm-lock.yaml` (REQ-DEV-002).

Run: `git status --short`
Expected: no lockfile under `packages/`; only `pnpm-lock.yaml` at root.

- [ ] **Step 2: Set the package version to the contract version** — in `packages/sdk/package.json`

```json
  "version": "1.0.0",
```

- [ ] **Step 3: Write the failing test** — `packages/sdk/src/contract-version.contract.spec.ts`

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { valid } from 'semver';
import {
  CONTRACT_VERSION,
  assertContractRangeSatisfied,
  isContractRangeSatisfied,
} from './contract-version';
import { ContractError } from './errors/error-codes';

describe('contract version', () => {
  it('is a valid semver version', () => {
    expect(valid(CONTRACT_VERSION)).not.toBeNull();
  });

  // REQ-CTR-004: "Версия SDK = версия контракта". Two sources of the same truth
  // drift; this test is what keeps them one.
  it('equals the SDK package version', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(pkg.version).toBe(CONTRACT_VERSION);
  });

  it.each(['^1.0.0', '>=1.0.0 <2.0.0', '1.x'])('accepts a compatible range: %s', (range) => {
    expect(isContractRangeSatisfied(range)).toBe(true);
  });

  it.each(['^2.0.0', '>=1.5.0', '0.9.x'])('rejects an incompatible range: %s', (range) => {
    expect(isContractRangeSatisfied(range)).toBe(false);
  });

  it.each(['garbage!!', '', 'not-a-range'])('rejects a malformed range: %s', (range) => {
    expect(isContractRangeSatisfied(range)).toBe(false);
  });

  it('asserts with a typed error the core can return outward', () => {
    expect(() => assertContractRangeSatisfied('^1.0.0')).not.toThrow();
    try {
      assertContractRangeSatisfied('^2.0.0');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ContractError);
      expect((err as ContractError).code).toBe('CONTRACT_VERSION_INCOMPATIBLE');
    }
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/contract-version -v`
Expected: FAIL — `Cannot find module './contract-version'`.

- [ ] **Step 5: Write the implementation** — `packages/sdk/src/contract-version.ts`

```ts
import { satisfies, validRange } from 'semver';
import { ContractError } from './errors/error-codes';

// The version of the core↔module contract. REQ-CTR-004: the SDK version IS the
// contract version — packages/sdk/package.json is kept equal to this by a contract
// test. Versioning from day one is the enforcement mechanism of the boundary, not
// preparation for a future consumer (ADR-002).
export const CONTRACT_VERSION = '1.0.0';

// A manifest declares the range of contract versions it is compatible with; the
// core checks it at registration (REQ-CTR-004). A malformed range is not satisfied —
// it never silently passes as "no constraint".
export const isContractRangeSatisfied = (range: string): boolean =>
  validRange(range) !== null && satisfies(CONTRACT_VERSION, range);

// Exported so the registration service in the later core plan cannot express this
// check any other way than with the typed error the norm requires.
export const assertContractRangeSatisfied = (range: string): void => {
  if (!isContractRangeSatisfied(range)) {
    throw new ContractError(
      'CONTRACT_VERSION_INCOMPATIBLE',
      `manifest requires contract range "${range}", core provides ${CONTRACT_VERSION}`,
    );
  }
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/contract-version -v`
Expected: PASS — 12 tests.

- [ ] **Step 7: Export and check the boundary still holds**

Add to `packages/sdk/src/index.ts`, as the first line:

```ts
export * from './contract-version';
```

Run: `pnpm run boundary-check`
Expected: no violations — `semver` is a `node_modules` dependency, so `sdk-is-leaf` is unaffected.

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/package.json packages/sdk/src/contract-version.ts packages/sdk/src/contract-version.contract.spec.ts packages/sdk/src/index.ts pnpm-lock.yaml
git commit -m "feat(sdk): contract version = SDK version, with range satisfaction (REQ-CTR-004)"
```

---

