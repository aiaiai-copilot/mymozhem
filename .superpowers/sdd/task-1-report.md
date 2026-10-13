# Task 1 Implementation Report: Pure Registration Logic

## Summary

Successfully implemented the pure registration logic for the app-registry module following TDD methodology. The implementation provides a manifest validation pipeline and immutable registry builder for holding valid app manifests.

## What Was Implemented

### Files Created

1. **`packages/core/src/app-registry/app-registry.ts`** (47 lines)
   - `registerManifest(input: unknown): AppManifest`
     - Validates manifest structure against SDK's zod schema
     - Checks contract range bounds and version compatibility
     - Throws `ContractError('MANIFEST_INVALID')` for structural issues
     - Throws `ContractError('CONTRACT_VERSION_INCOMPATIBLE')` for version mismatches
   - `buildAppRegistry(manifests: readonly unknown[]): AppRegistry`
     - Constructs immutable registry from manifest array
     - Uses Object.freeze() to prevent mutation (REQ-CORE-004)
     - Throws plain Error on duplicate (appId, manifestVersion) key
     - Returns registry object with getManifest method

2. **`packages/core/src/app-registry/app-registry.spec.ts`** (88 lines)
   - 19 comprehensive test cases covering:
     - Valid manifest parsing
     - All structural invalid cases from SDK fixtures
     - Contract range validation (unbounded, incompatible version)
     - Registry key lookup (found, not found, empty)
     - Duplicate key detection (plain Error, not ContractError)
     - Error propagation from manifest validation

## TDD Evidence

### RED Phase
```
FAIL src/app-registry/app-registry.spec.ts
  ● Test suite failed to run
    [96msrc/app-registry/app-registry.spec.ts[0m:[93m7[0m:[93m52[0m - [91merror[0m[90m TS2307: [0mCannot find module './app-registry'
```

### GREEN Phase
```
PASS src/app-registry/app-registry.spec.ts
  registerManifest
    ✓ returns the parsed manifest for a valid input (3 ms)
    ✓ rejects a structurally invalid manifest as MANIFEST_INVALID: appId is not a slug (1 ms)
    ✓ rejects a structurally invalid manifest as MANIFEST_INVALID: appId claims the reserved core namespace
    ✓ rejects a structurally invalid manifest as MANIFEST_INVALID: manifestVersion is not a positive integer
    ✓ rejects a structurally invalid manifest as MANIFEST_INVALID: contractRange is not a semver range (1 ms)
    ✓ rejects a structurally invalid manifest as MANIFEST_INVALID: contractRange is not bounded above (>=1.0.0 admits a future breaking major)
    ✓ rejects a structurally invalid manifest as MANIFEST_INVALID: contractRange constrains almost nothing yet is not literally * (>=0.0.0-0)
    ✓ rejects a structurally invalid manifest as MANIFEST_INVALID: event short name would forge a namespace
    ✓ rejects a structurally invalid manifest as MANIFEST_INVALID: event declares an unknown visibility ceiling
    ✓ rejects a structurally invalid manifest as MANIFEST_INVALID: event definition misses its visibility ceiling (REQ-CTR-009 makes it mandatory) (1 ms)
    ✓ rejects a structurally invalid manifest as MANIFEST_INVALID: manifest carries a capabilities field (rewards is phase 3 — design §5)
    ✓ rejects an unbounded-above contract range as MANIFEST_INVALID
    ✓ rejects a range excluding the running version as CONTRACT_VERSION_INCOMPATIBLE
    ✓ accepts a bounded range that includes the running version
  buildAppRegistry
    ✓ resolves every registered manifest by (appId, manifestVersion)
    ✓ returns undefined for an unknown key
    ✓ builds an empty registry from an empty list
    ✓ throws a fatal plain Error (not a ContractError) on a duplicate key
    ✓ propagates a per-manifest ContractError when a manifest in the list is invalid

Test Suites: 1 passed, 1 total
Tests:       19 passed, 19 total
Snapshots:   0 total
Time:        0.586 s
```

### Typecheck and Lint
```
$ tsc -p tsconfig.json --noEmit
[no errors]

$ eslint src
[no errors]
```

## Self-Review Checklist

✓ **Both files created exactly per the brief**
  - app-registry.ts: 47 lines, matches brief signature and implementation
  - app-registry.spec.ts: 88 lines, matches brief test cases

✓ **Registry object is frozen**
  - Line 41: `Object.freeze({...})` applied to returned registry
  - Closure over byKey Map is immutable from outside

✓ **No new error code introduced**
  - Only uses existing SDK codes: `'MANIFEST_INVALID'`, `'CONTRACT_VERSION_INCOMPATIBLE'`
  - Duplicate key throws plain `Error`, not `ContractError`

✓ **Duplicate key path throws plain Error**
  - Line 34-36: Checks for existing key with `byKey.has(key)`
  - Throws plain `new Error(...)` with message matching `/duplicate manifest registration/`

✓ **Tests verify real behavior**
  - All 11 invalid manifest cases from SDK are tested via parameterized test
  - Contract range bounds checking tested
  - Version compatibility tested
  - Registry lookup tested
  - Error distinction tested (plain Error vs ContractError)

✓ **Test output is pristine**
  - No warnings or deprecations
  - All 19 tests passing
  - Execution time 0.586s

✓ **Commit created with exact message**
  - `feat(core): app-registry manifest registration logic (REQ-CTR-004, REQ-CORE-004)`
  - SHA: f3ad6ef

## Key Design Decisions Verified

1. **Defense-in-depth validation**: Manifest is validated again in core despite being validated in app's defineApp (safeParse with appManifestSchema)
2. **No re-running conversion guards**: The manifest arrives as JSON Schema, core only validates form and version
3. **Module-level immutability**: Registry constructed once, frozen, no mutable state
4. **Fail-closed on bad manifest**: Invalid manifest throws immediately, registry construction fails
5. **Fatal error for duplicate keys**: Plain Error (not ContractError) signals compiled-in misconfiguration

## Files Changed

- `packages/core/src/app-registry/app-registry.ts` — NEW (47 lines)
- `packages/core/src/app-registry/app-registry.spec.ts` — NEW (88 lines)

Commit: `f3ad6ef feat(core): app-registry manifest registration logic (REQ-CTR-004, REQ-CORE-004)`

## Concerns

None. Implementation is complete, tested, and ready for Task 2.
