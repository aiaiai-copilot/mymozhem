# Task 4 Report: Outward projection envelope without seq

## Summary

Implemented the outward projection envelope schema that carries events leaving the core toward a client. The projection structurally excludes `seq`, `visibility`, and `roomId` fields from the internal `LogEvent`, preventing information leakage.

## Implementation Details

### Files Created

1. **`packages/sdk/src/events/projected-event.schema.ts`**
   - Defines `projectedEventSchema` using `z.strictObject()` (not `z.object()`) to reject extra keys
   - Contains exactly 3 fields: `type`, `payload`, `actorId`
   - `type` uses `eventTypeSchema` from Task 3 to validate namespaced event types
   - `payload` is a generic record mapping string keys to unknown values
   - `actorId` is a UUID or null
   - Exported type: `ProjectedEvent`

2. **`packages/sdk/src/events/projected-event.fixtures.ts`**
   - 2 valid projected event fixtures
   - 5 invalid test cases covering:
     - Whole log envelope spread outward (leaks seq)
     - Seq smuggled onto a clean projection
     - Visibility label sent outward
     - Replay cursor sent outward (MVP has none)
     - Event type without owning namespace

3. **`packages/sdk/src/events/projected-event.contract.spec.ts`**
   - 8 contract tests total
   - Tests valid fixtures 0 and 1
   - Tests all 5 invalid cases
   - Verifies schema shape constraint: exactly `['actorId', 'payload', 'type']` fields

### Files Modified

- **`packages/sdk/src/index.ts`**
  - Added export of `projected-event.schema`
  - Added export of `projected-event.fixtures`

## Test Results

### TDD Evidence

**RED (before schema implementation):**
```
FAIL src/events/projected-event.contract.spec.ts
  ● Test suite failed to run
    error TS2307: Cannot find module './projected-event.schema'
```

**GREEN (after schema implementation):**
```
PASS src/events/projected-event.contract.spec.ts
  projectedEvent contract
    ✓ accepts valid fixture #0 (1 ms)
    ✓ accepts valid fixture #1
    ✓ rejects invalid fixture: whole log envelope spread outward (leaks seq — REQ-RT-011a)
    ✓ rejects invalid fixture: seq smuggled onto an otherwise clean projection
    ✓ rejects invalid fixture: visibility label sent outward
    ✓ rejects invalid fixture: replay cursor sent outward (no cursor exists in MVP — design §4.4)
    ✓ rejects invalid fixture: event type without an owning namespace
    ✓ has no seq, visibility or cursor field to expose

Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
```

### Full SDK Test Suite

```
Test Suites: 5 passed, 5 total
Tests:       56 passed, 56 total
  - All Tasks 1-3 tests remain passing (48 tests)
  - Task 4 new tests: 8 tests
```

### Linting

```
$ eslint src
(no errors or warnings)
```

## Self-Review

✓ **Completeness:** All files from brief's list created/modified
- Created: `projected-event.schema.ts`, `projected-event.fixtures.ts`, `projected-event.contract.spec.ts`
- Modified: `index.ts`

✓ **Discipline:** Built exactly what the brief specified
- Used `z.strictObject()` as deliberate design, not `z.object()`
- Schema has exactly 3 fields: `type`, `payload`, `actorId`
- No extra exports, no helper functions beyond requirements

✓ **Testing:** Tests verify real structural constraints
- All 8 tests pass
- Test output pristine (no warnings)
- Fixtures cover both valid projections and realistic invalid cases
- Field constraint test ensures schema shape is exactly as designed

✓ **Integration:** No breaking changes
- Full SDK test suite passes (56 tests)
- Linting passes
- New package exports follow existing pattern
- Dependencies (eventTypeSchema, LogEvent) already green

## Commit

```
0666e8d feat(sdk): outward projection envelope carries no seq (REQ-RT-001, REQ-RT-011)
```

## Concerns

None. Implementation is complete, tests pass, and integration is clean.
