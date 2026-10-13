# Task 8 Report: Per-property appSettings visibility, fail-safe

## What was implemented

Four exports in `packages/sdk/src/manifest/app-settings-visibility.ts`:

1. **`VISIBILITY_ANNOTATION`** — constant `'x-visibility'` per ADR-008
2. **`readPropertyVisibility(appSettings, property): Visibility`** — reads the visibility level of a property, defaulting to `'module-private'` (fail-safe) for:
   - Absent annotations (REQ-CORE-008)
   - Unannotated properties
   - Unknown properties
   - Malformed schema shapes (missing `properties` block, non-object properties, etc.)
3. **`appSettingsVisibilityMap(appSettings): Record<string, Visibility>`** — builds a complete visibility map of all properties
4. **`assertVisibilityAnnotations(appSettings): void`** — validates that all *present* annotations are valid enum values; throws `ContractError` with code `MANIFEST_INVALID` on misspelled annotations (e.g., `'publik'`), catching authoring mistakes at registration

The implementation:
- Uses `asRecord()` helper for safe type narrowing (returns `null` if not an object)
- Leverages `visibilitySchema.safeParse()` for validation (no exceptions on unknown values)
- Includes comprehensive comments explaining the fail-safe principle and ADR-008 rationale
- Exports added to `packages/sdk/src/index.ts`

## What was tested and results

**Test file:** `packages/sdk/src/manifest/app-settings-visibility.contract.spec.ts` — 12 contract tests

All tests verify the fail-safe defaults and error behavior:
- Correct reading of all three visibility levels (`public`, `organizer`, `module-private`)
- Unannotated and unknown properties default to `module-private`
- Schema shape edge cases (missing `properties`, non-object `properties` or property definitions) all default to `module-private`
- Complete visibility mapping with defaults
- Assertion accepts valid and absent annotations
- Assertion rejects misspelled annotations with `MANIFEST_INVALID`

## TDD Evidence

### RED — Command and failure output (before implementation)

```bash
pnpm --filter @mymozhem/sdk exec jest src/manifest/app-settings-visibility --verbose
```

**Expected failure:** Module not found
```
FAIL src/manifest/app-settings-visibility.contract.spec.ts
  ● Test suite failed to run

    src/manifest/app-settings-visibility.contract.spec.ts:8:8 - error TS2307: Cannot find module './app-settings-visibility' or its corresponding type declarations.

    8 } from './app-settings-visibility';
        ~~~~~~~~~~~~~~~~~~~~~~~~~~~

Test Suites: 1 failed, 1 total
Tests:       0 total
```

This was the expected RED state: the import failed because the implementation file did not exist yet.

### GREEN — Command and passing output (after implementation)

```bash
pnpm --filter @mymozhem/sdk exec jest src/manifest/app-settings-visibility --verbose
```

**All tests passing:**
```
PASS src/manifest/app-settings-visibility.contract.spec.ts
  appSettings per-property visibility
    ✓ uses the annotation ADR-008 mandates (1 ms)
    ✓ reads the declared level of title
    ✓ reads the declared level of scoreboardMode
    ✓ reads the declared level of correctAnswers
    ✓ treats an unannotated property as module-private
    ✓ treats an unknown property as module-private (1 ms)
    ✓ fails safe when the schema is shaped unexpectedly: no properties block
    ✓ fails safe when the schema is shaped unexpectedly: properties is not an object
    ✓ fails safe when the schema is shaped unexpectedly: property is not an object
    ✓ maps every property, defaulting the unannotated ones
    ✓ accepts annotations that are absent or valid
    ✓ rejects a misspelled annotation instead of silently hiding the property (3 ms)

Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
```

### Full package test suite

Verified all 100 tests in `@mymozhem/sdk` still pass:
```
Test Suites: 9 passed, 9 total
Tests:       100 passed, 100 total
```

## Files changed

1. **Created:** `packages/sdk/src/manifest/app-settings-visibility.ts` (73 lines)
   - Core implementation with all four exports
   - Helper functions for safe type narrowing (`asRecord`, `propertiesOf`)
   - Comments explaining fail-safe defaults and ADR-008 integration

2. **Created:** `packages/sdk/src/manifest/app-settings-visibility.contract.spec.ts` (92 lines)
   - Complete test fixture and 12 contract tests
   - Edge cases: missing properties block, non-object properties, malformed schema

3. **Modified:** `packages/sdk/src/index.ts`
   - Added: `export * from './manifest/app-settings-visibility';` after manifest.fixtures export

## Commit

- **Hash:** `72b5dad`
- **Message:** `feat(sdk): fail-safe per-property appSettings visibility (REQ-CORE-008, ADR-008)`

## Self-review findings

### Completeness
- ✅ All four required exports implemented
- ✅ Both fail-safe read and loud assert, as specified in design note
- ✅ Covers all test cases from brief (present, absent, misspelled, schema edge cases)
- ✅ Added to index.ts after correct position (manifest.fixtures)

### Quality
- ✅ Code follows pattern of sibling files in `packages/sdk/src/manifest/` and `packages/sdk/src/visibility/`
- ✅ Clear, descriptive helper function names (`asRecord`, `propertiesOf`)
- ✅ Comments explain fail-safe principle and why both read+assert are needed
- ✅ Uses zod as single source of truth (`visibilitySchema.safeParse()`)
- ✅ Type safety: infers `Visibility` type from schema, never writes parallel TS types

### Discipline
- ✅ No overbuilding: exactly the four exports named in brief
- ✅ No module-level state (`let`/`var`)
- ✅ No external imports outside SDK (uses only visibility, manifest.schema, error-codes)
- ✅ Typed error codes only: `MANIFEST_INVALID` passed to ContractError, not raw message

### Testing
- ✅ All 12 tests verify real behavior (not just type checks)
- ✅ Output pristine: no warnings, 12/12 passing
- ✅ Full package test suite green: 100/100 tests passing

## Issues or concerns

None. The implementation is complete, well-tested, and follows all project constraints and patterns.
