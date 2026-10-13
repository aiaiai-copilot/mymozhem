# Task 6 Report: Contract version and range satisfaction

## What I implemented

- `packages/sdk/package.json`: added `semver` (`^7.8.5`) to `dependencies` and
  `@types/semver` (`^7.7.1`) to `devDependencies`; bumped `"version"` from `0.0.0`
  to `1.0.0` (REQ-CTR-004: SDK version = contract version).
- `packages/sdk/src/contract-version.ts` (new): exports
  - `CONTRACT_VERSION = '1.0.0'`
  - `isContractRangeSatisfied(range: string): boolean`
  - `assertContractRangeSatisfied(range: string): void` — throws `ContractError`
    with code `CONTRACT_VERSION_INCOMPATIBLE` when the range is not satisfied.
- `packages/sdk/src/contract-version.contract.spec.ts` (new): the brief's test,
  with the malformed-range case extended per the controller's correction.
- `packages/sdk/src/index.ts`: added `export * from './contract-version';` as the
  first line.

### The correction, as implemented

Per the controller's resolution, `isContractRangeSatisfied` normalizes the input
range with `semver`'s `validRange` before judging it, rather than testing the
input spelling:

```ts
export const isContractRangeSatisfied = (range: string): boolean => {
  const normalized = validRange(range);
  if (normalized === null || normalized === '*') return false;
  return satisfies(CONTRACT_VERSION, range);
};
```

- `normalized === null` → the range failed to parse at all (e.g. `'garbage!!'`,
  `'not-a-range'`) — malformed, refused.
- `normalized === '*'` → the range parsed but constrains nothing (e.g. `''`,
  `'*'`, and the other spellings the controller enumerated — `'x'`, `'X'`,
  `'>=0.0.0'`, `'*.*.*'`, `' '`, `'||'`, `'1 || *'`, `'x.x.x'` all normalize to
  `'*'` under semver 7.8.5) — refused, because a manifest that constrains
  nothing has not declared compatibility, it has opted out of the REQ-CTR-004
  check. Checking the *normalized* form catches all these spellings at once
  instead of enumerating them, which would leave the invariant held by
  enumeration — exactly the kind of drift this codebase rejects elsewhere.
- Otherwise, falls through to `satisfies(CONTRACT_VERSION, range)`.

I did **not** add any handling for upper-unbounded ranges (e.g. `'>=1.0.0'`) or
for ranges like `'>=0.0.0-0'` that constrain almost nothing without normalizing
to `'*'`. Per the brief's correction, that is a separate contract-design
question for the owner, out of scope here, and untested here.

The malformed-range test was extended and renamed to cover both categories
(malformed and unconstrained):

```ts
it.each(['garbage!!', '', 'not-a-range', '*'])(
  'rejects a range that constrains nothing or is malformed: %s',
  (range) => {
    expect(isContractRangeSatisfied(range)).toBe(false);
  },
);
```

## What I tested and the results

Focused suite: `contract-version.contract.spec.ts` — **13 passed, 13 total**
(12 from the brief + 1 for the added `'*'` case). Test output is pristine — no
warnings.

```
PASS src/contract-version.contract.spec.ts
  contract version
    ✓ is a valid semver version (1 ms)
    ✓ equals the SDK package version
    ✓ accepts a compatible range: ^1.0.0 (1 ms)
    ✓ accepts a compatible range: >=1.0.0 <2.0.0 (1 ms)
    ✓ accepts a compatible range: 1.x
    ✓ rejects an incompatible range: ^2.0.0
    ✓ rejects an incompatible range: >=1.5.0
    ✓ rejects an incompatible range: 0.9.x
    ✓ rejects a range that constrains nothing or is malformed: garbage!!
    ✓ rejects a range that constrains nothing or is malformed:
    ✓ rejects a range that constrains nothing or is malformed: not-a-range
    ✓ rejects a range that constrains nothing or is malformed: *
    ✓ asserts with a typed error the core can return outward

Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
```

Full package suite: `pnpm --filter @mymozhem/sdk test` — **7 suites, 78 tests,
all passed** (was 65/65 before this task; 78 = 65 + 13 new).

Lint: `pnpm --filter @mymozhem/sdk run lint` — clean, no output beyond the
command echo.

Typecheck: `pnpm --filter @mymozhem/sdk run typecheck` — clean.

Boundary check: `pnpm run boundary-check` — see below, no violations.

### Note on the focused-test command

The brief and repo conventions both specify
`pnpm --filter @mymozhem/sdk exec jest src/contract-version -v`. That `-v` flag
is rejected outright by this repo's installed Jest CLI (29.7.0) with
`Unrecognized CLI Parameter: "v"` — I confirmed this is a pre-existing
environment quirk unrelated to this task's code, by running the same `-v` flag
against an already-passing, untouched spec (`src/errors`) and getting the
identical error. I used `--verbose` instead (Jest's actual flag), which
produced the per-test output shown above. Not raising this as a blocking
contradiction since it's a CLI-flag typo, not a test/implementation
disagreement — flagging it here per "ask/report, don't silently paper over."

## TDD Evidence

**RED** — command: `npx jest src/contract-version --verbose` (run from
`packages/sdk`), before `contract-version.ts` existed:

```
FAIL src/contract-version.contract.spec.ts
  ● Test suite failed to run

    src/contract-version.contract.spec.ts:8:8 - error TS2307: Cannot find module './contract-version' or its corresponding type declarations.

    8 } from './contract-version';
             ~~~~~~~~~~~~~~~~~~~~

Test Suites: 1 failed, 1 total
Tests:       0 total
```

Expected failure exactly as the brief predicted for Step 4 (`Cannot find module
'./contract-version'`) — confirms the test file was in place and exercised
before any implementation existed.

**GREEN** — command: `npx jest src/contract-version --verbose` (run from
`packages/sdk`), after `contract-version.ts` was written and `index.ts` updated:
13/13 passing, shown in full above.

## Files changed

- `packages/sdk/package.json` (modified: version bump, `semver` +
  `@types/semver` deps)
- `packages/sdk/src/contract-version.ts` (new)
- `packages/sdk/src/contract-version.contract.spec.ts` (new)
- `packages/sdk/src/index.ts` (modified: new export as first line)
- `pnpm-lock.yaml` (modified, root only)

## git status --short after the dependency add (Step 1)

```
 M packages/sdk/package.json
 M pnpm-lock.yaml
```

Only the root `pnpm-lock.yaml` changed. `find packages -name pnpm-lock.yaml
-not -path '*/node_modules/*'` returned nothing — no lockfile under
`packages/`. REQ-DEV-002 (one lockfile per monorepo) holds.

## pnpm run boundary-check output

```
$ depcruise apps packages --config .dependency-cruiser.cjs

✔ no dependency violations found (85 modules, 140 dependencies cruised)
```

No violations. `semver` is a `node_modules` runtime dependency, so the
`sdk-is-leaf` rule is unaffected, as the brief predicted.

## Self-review findings

- **Completeness:** all four files from the brief's Files list
  created/modified. All brief tests present plus the `'*'` case from the
  correction. `@mymozhem/core` version confirmed untouched at `0.0.0` (no
  `@mymozhem/server` package exists yet in this repo, so nothing to check
  there).
- **Discipline:** implementation contains exactly the three exports the brief
  specifies (`CONTRACT_VERSION`, `isContractRangeSatisfied`,
  `assertContractRangeSatisfied`) — no extra exports, no handling for
  upper-unbounded ranges, no helpers beyond what was asked. The guard's two
  conditions (`null`, `'*'`) are exactly what the correction specified — I did
  not add extra enumerated cases since normalization already collapses them.
- **Testing:** all assertions exercise real behavior (semver's actual
  `validRange`/`satisfies`, not mocked); test output is pristine, no stray
  warnings from Jest or ts-jest.

No issues found in self-review; nothing needed fixing.

## Concerns

- The `-v` vs `--verbose` Jest CLI mismatch noted above — pre-existing
  environment issue, not something this task's changes caused or should fix.
- Everything else matched the brief and the controller's correction exactly;
  no other contradictions found between brief text, test expectations, and
  actual semver 7.8.5 behavior.

## Unconstrained-range guard confirmation

Implemented exactly as the controller specified: `isContractRangeSatisfied`
computes `validRange(range)` and refuses (`false`) when the normalized result
is either `null` (malformed / unparseable) or `'*'` (parses but constrains
nothing). This is tested directly — the extended
`it.each(['garbage!!', '', 'not-a-range', '*'])` test in
`contract-version.contract.spec.ts` includes `'*'` explicitly alongside the
brief's three malformed-input cases, and all four assert
`isContractRangeSatisfied(range)` is `false`. Confirmed passing in the GREEN
run above (4/4 of that `it.each` block green, including the `*` row).
