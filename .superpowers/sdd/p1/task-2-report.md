# Task 2 Report: Typed Error Codes

## What Was Implemented

Implemented the complete typed error code system for the SDK contract boundary per REQ-SEC-006:

1. **Error Code Constants** — `CONTRACT_ERROR_CODES` array with exactly 10 codes as specified in design §8:
   - `MANIFEST_INVALID`
   - `CONTRACT_VERSION_INCOMPATIBLE`
   - `SCHEMA_NOT_REPRESENTABLE`
   - `EVENT_UNKNOWN_TYPE`
   - `EVENT_PAYLOAD_INVALID`
   - `EVENT_VISIBILITY_WEAKER_THAN_DECLARED`
   - `EVENT_PAYLOAD_TOO_LARGE`
   - `EVENT_RATE_LIMITED`
   - `ROOM_LOG_SEALED`
   - `ROOM_SETTINGS_FROZEN`

2. **Type Safety** — `ContractErrorCode` type inferred from the constant array, ensuring type safety across the codebase.

3. **Zod Schemas**:
   - `contractErrorCodeSchema` — validates that a value is one of the known codes
   - `contractErrorPayloadSchema` — `z.strictObject()` enforcing that only `code` field is present (no `message`, no `stack` leakage)

4. **ContractError Class** — extends Error with:
   - `readonly code: ContractErrorCode` property
   - `constructor(code, message)` that captures the message for server-side logging
   - `toPayload(): ContractErrorPayload` method that returns only `{ code: '...' }` for network transmission

5. **Package Surface Export** — added `export * from './errors/error-codes'` to `packages/sdk/src/index.ts` above the visibility line.

## Testing

### TDD Flow

**RED Phase:**
```bash
pnpm --filter @mymozhem/sdk exec jest src/errors --verbose
```
Result: Test suite failed to compile with `TS2307: Cannot find module './error-codes'` — expected, module did not exist yet.

**GREEN Phase:**
```bash
pnpm --filter @mymozhem/sdk exec jest src/errors --verbose
```
Result:
```
PASS src/errors/error-codes.contract.spec.ts
  contract errors
    ✓ exports exactly the codes named by the design §8 (1 ms)
    ✓ rejects an unknown code
    ✓ carries its code and stays a real Error
    ✓ projects outward as a bare code, leaking neither message nor stack (1 ms)
    ✓ rejects an outward payload that smuggles extra fields

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

### Full Package Test Suite
```bash
pnpm --filter @mymozhem/sdk exec jest --verbose
```
Result:
```
Test Suites: 3 passed, 3 total
Tests:       25 passed, 25 total
```
All tests across the SDK package pass, including the 5 new contract error tests plus existing visibility and log-event tests.

### Linting
```bash
pnpm --filter @mymozhem/sdk run lint
```
Result: Clean, no errors or warnings.

## Files Changed

- **Created:** `packages/sdk/src/errors/error-codes.ts` (43 lines)
- **Created:** `packages/sdk/src/errors/error-codes.contract.spec.ts` (64 lines)
- **Modified:** `packages/sdk/src/index.ts` (added 1 line export at top)

## Commit

```
commit 4ee2e63
feat(sdk): typed contract error codes, code-only wire form (REQ-SEC-006)
```

## Self-Review Findings

✓ **Completeness:** All requirements from the brief implemented:
  - All 10 error codes present and in correct order
  - Type safety with `ContractErrorCode`
  - Both schemas implemented with correct constraints
  - `ContractError` class with `code` property and `toPayload()` method
  - Package surface export in correct location

✓ **Quality:**
  - Code follows existing patterns from `visibility/visibility.ts` and `events/log-event.schema.ts`
  - Comments explain the REQ-SEC-006 rationale for `strictObject` and message suppression
  - Variable and function names are clear and accurate
  - No unnecessary complexity

✓ **Discipline:**
  - Followed TDD strictly: test first, watch fail, implement, watch pass
  - No overbuilding: exactly what the brief specified, no extra fields or methods
  - Adhered to SDK-as-leaf constraint (no imports from other workspace packages)
  - Zod is source of truth; types inferred from schemas

✓ **Testing:**
  - All 5 contract tests pass
  - Tests verify the critical behavior: exact code set, validation, code-only payload, strictness against smuggling
  - No stray warnings in output
  - Full package test suite still passes (25 tests total)

## Issues or Concerns

None. The implementation is complete, tested, and clean.
