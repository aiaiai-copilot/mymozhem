# Task 7: Manifest Schema — Implementation Report

## Summary

Implemented the zod schema for the app manifest — the document an app hands the core at registration. The manifest declares its id, settings schema, and event types with visibility ceilings.

## What Was Implemented

### Files Created
1. **`packages/sdk/src/manifest/manifest.fixtures.ts`**
   - Valid manifest fixture (1 case): a quiz app with two event types
   - Invalid manifest cases (8 cases): testing all validation rules
     - appId validation (slug, non-core)
     - manifestVersion validation (positive integer)
     - contractRange validation (semver)
     - event short name validation (dotted lowercase path)
     - event visibility validation (must be one of three levels)
     - event visibility ceiling requirement (mandatory per REQ-CTR-009)
     - strict object validation (rejects unknown fields like `capabilities`)

2. **`packages/sdk/src/manifest/manifest.contract.spec.ts`**
   - Test suite with 10 tests total:
     - 1 test for valid fixture
     - 8 tests for invalid cases (one per invalid case)
     - 1 test for contractRangeSchema (semver validation)

3. **`packages/sdk/src/manifest/manifest.schema.ts`**
   - `jsonSchemaObjectSchema`: structural JSON Schema placeholder (z.record)
   - `contractRangeSchema`: semver range validation using `validRange()` from semver package
   - `manifestEventSchema`: per-type schema with mandatory visibility ceiling
   - `appManifestSchema`: full manifest with strictObject (rejects unknown fields)
   - Type exports: `JsonSchemaObject`, `AppManifest`

### Files Modified
- **`packages/sdk/src/index.ts`**: Added exports for manifest schema and fixtures

## Testing

### TDD Evidence

**Step 1-2: RED** — Fixtures and tests created, run to verify failure:
```bash
pnpm --filter @mymozhem/sdk exec jest src/manifest/manifest --verbose
```
Output:
```
FAIL src/manifest/manifest.contract.spec.ts
  ● Test suite failed to run

    Cannot find module './manifest.schema' or its corresponding type declarations.
```
✓ Fails with the expected missing module error (not a CLI argument error)

**Step 3-4: GREEN** — Implementation created, run to verify success:
```bash
pnpm --filter @mymozhem/sdk exec jest src/manifest/manifest --verbose
```
Output:
```
PASS src/manifest/manifest.contract.spec.ts
  app manifest contract
    ✓ accepts valid fixture #0 (3 ms)
    ✓ rejects invalid fixture: appId is not a slug
    ✓ rejects invalid fixture: appId claims the reserved core namespace
    ✓ rejects invalid fixture: manifestVersion is not a positive integer (1 ms)
    ✓ rejects invalid fixture: contractRange is not a semver range
    ✓ rejects invalid fixture: event short name would forge a namespace
    ✓ rejects invalid fixture: event declares an unknown visibility ceiling
    ✓ rejects invalid fixture: event definition misses its visibility ceiling (REQ-CTR-009 makes it mandatory)
    ✓ rejects invalid fixture: manifest carries a capabilities field (rewards is phase 3 — design §5) (1 ms)
    ✓ accepts any well-formed semver range and refuses nonsense

Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
```
✓ All 10 tests pass (brief predicted 12, but actual implementation yields 10)

### Full Suite Verification
```bash
pnpm --filter @mymozhem/sdk test
```
Result: **88 tests pass** (was 78 before, gained 10 from manifest tests)

### Lint Verification
```bash
pnpm --filter @mymozhem/sdk run lint
```
Result: ✓ No lint errors

## Self-Review Findings

**Completeness:**
- ✓ All three files in task created (`manifest.schema.ts`, `manifest.fixtures.ts`, `manifest.contract.spec.ts`)
- ✓ Package surface modified (`index.ts`)
- ✓ All fixtures and test cases present (1 valid, 8 invalid, 1 semver test)

**Discipline:**
- ✓ Built only what brief asks: no `capabilities` field added to schema
- ✓ No meta-schema for JSON Schema (deliberately structural as brief requires)
- ✓ No extra exports beyond what brief specifies
- ✓ Maintained NB comment about `.refine()` being legal in core-owned schemas
- ✓ strictObject used correctly (rejects unknown fields)
- ✓ Tasks 8 and 9 own the manifest's rules (not anticipated here)

**Testing Quality:**
- ✓ Valid fixture tests real-world quiz manifest
- ✓ Each invalid fixture fails for its stated reason (verified via test names)
- ✓ semver range validation covers both valid and invalid cases
- ✓ visibility field is mandatory (REQ-CTR-009 enforced)
- ✓ strictObject catches unknown fields (capabilities test verifies)

**Implementation Details:**
- ✓ Uses exact code from brief verbatim
- ✓ Consumes correct schemas: `visibilitySchema`, `appIdSchema`, `shortEventNameSchema`
- ✓ Consumes `validRange` from semver dependency (already available)
- ✓ No module-level mutable state (ESLint passes)

## Files Changed

1. Created: `/Users/alexanderlapygin/Projects/mymozhem/packages/sdk/src/manifest/manifest.schema.ts`
2. Created: `/Users/alexanderlapygin/Projects/mymozhem/packages/sdk/src/manifest/manifest.fixtures.ts`
3. Created: `/Users/alexanderlapygin/Projects/mymozhem/packages/sdk/src/manifest/manifest.contract.spec.ts`
4. Modified: `/Users/alexanderlapygin/Projects/mymozhem/packages/sdk/src/index.ts`

## Issues and Concerns

None. All work completed as specified. Test count (10) differs from brief prediction (12), but brief notes explicitly allow this and request reporting the actual number.
