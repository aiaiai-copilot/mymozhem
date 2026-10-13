# Task 3 Report: Event-type namespace and structural owner resolution

## Summary

Task 3 implements structural event-type ownership resolution via namespace parsing. An event type like `core.room.activated` or `quiz.answer.submitted` is parsed to determine ownership: `core` namespace belongs to the core, any other namespace belongs to the app with that name. This prevents apps from forging types in foreign namespaces because namespace prefixing is unconditional and inexpressible to override.

## Implementation

### Files Created

1. **`packages/sdk/src/events/event-type.ts`** — Core module
   - `CORE_NAMESPACE = 'core'` constant
   - `appIdSchema` — validates app IDs as lowercase slugs, refusing `core`
   - `shortEventNameSchema` — validates short event names (dotted lowercase paths)
   - `eventTypeSchema` — validates fully-qualified event types (`<namespace>.<shortName>`)
   - `composeEventType(namespace, shortName)` — combines namespace and short name
   - `TypeOwner` type — represents resolved ownership
   - `resolveTypeOwner(type)` — parses a type string and returns its owner, throwing `ContractError('EVENT_UNKNOWN_TYPE', ...)` on invalid input

2. **`packages/sdk/src/events/event-type.contract.spec.ts`** — Comprehensive test suite (13 tests, all passing)

### Files Modified

1. **`packages/sdk/src/events/log-event.schema.ts`**
   - Added import: `import { eventTypeSchema } from './event-type';`
   - Changed `type: z.string().min(1)` to `type: eventTypeSchema` to enforce structural validation

2. **`packages/sdk/src/events/log-event.fixtures.ts`**
   - Re-namespaced `validLogEvents[0].type` from `'room.created'` to `'core.room.activated'`
   - Updated payload from `{ policy: 'guests' }` to `{ appId: 'quiz', manifestVersion: 1 }`
   - Added 5th invalid case: `'event type without an owning namespace'` with `type: 'created'`

3. **`packages/sdk/src/index.ts`**
   - Added export: `export * from './events/event-type';` (placed after visibility exports, per spec)

## TDD Evidence

### Step 1-2: RED State
Command: `pnpm --filter @mymozhem/sdk exec jest src/events/event-type --verbose`

**Expected failure** (Step 2 of brief):
```
FAIL src/events/event-type.contract.spec.ts
  ● Test suite failed to run

    src/events/event-type.contract.spec.ts:8:8 - error TS2307: Cannot find module './event-type' or its corresponding type declarations.
```

### Step 3-4: GREEN State
After implementing `event-type.ts`, test output:
```
PASS src/events/event-type.contract.spec.ts
  event type ownership
    ✓ accepts a namespaced type: core.room.activated (1 ms)
    ✓ accepts a namespaced type: quiz.answer_scored
    ✓ accepts a namespaced type: quiz.answer.submitted
    ✓ rejects a malformed type: nodot
    ✓ rejects a malformed type: core.
    ✓ rejects a malformed type: .leading
    ✓ rejects a malformed type: Quiz.Answer
    ✓ rejects a malformed type: quiz..double
    ✓ resolves the core namespace to the core
    ✓ resolves any other namespace to the app that owns it
    ✓ rejects an unresolvable type with a typed error (3 ms)
    ✓ gives an app no way to declare into the core namespace
    ✓ reserves the core namespace against an app claiming it as its appId

Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
```

### Step 7: Full Package Test Suite
After updating log-event fixtures and exports:
```
PASS src/events/event-type.contract.spec.ts
PASS src/errors/error-codes.contract.spec.ts
PASS src/visibility/visibility.contract.spec.ts
PASS src/events/log-event.contract.spec.ts

Test Suites: 4 passed, 4 total
Tests:       39 passed, 39 total
```

### log-event.contract.spec.ts Detailed Verification
```
PASS src/events/log-event.contract.spec.ts
  logEvent contract
    ✓ accepts valid fixture #0
    ✓ accepts valid fixture #1
    ✓ rejects invalid fixture: unknown visibility level
    ✓ rejects invalid fixture: missing seq
    ✓ rejects invalid fixture: negative seq
    ✓ rejects invalid fixture: non-uuid roomId
    ✓ rejects invalid fixture: event type without an owning namespace (1 ms)
    ✓ rejects a visibility level weaker than the declared enum

Tests: 8 passed, 8 total
```

**Confirmed:** The phase-0 fixture spec now runs **5 invalid cases** (up from 4) and stays green.

### Lint & Typecheck
- **Lint:** `pnpm --filter @mymozhem/sdk run lint` — No output, no errors
- **Typecheck:** `pnpm --filter @mymozhem/sdk exec tsc --noEmit` — No output, no errors

## Commit

```
747c085 feat(sdk): structural event-type ownership by namespace (REQ-CTR-008, ADR-002)
```

Files changed:
- `packages/sdk/src/events/event-type.contract.spec.ts` (created, 76 lines)
- `packages/sdk/src/events/event-type.ts` (created, 50 lines)
- `packages/sdk/src/events/log-event.schema.ts` (modified, +1 import line, -1 type line)
- `packages/sdk/src/events/log-event.fixtures.ts` (modified, re-namespaced, +5th invalid case)
- `packages/sdk/src/index.ts` (modified, +1 export line)

## Self-Review

### Completeness
- [x] All steps from the brief implemented verbatim
- [x] Event-type namespace logic correct: `core.*` → core, `<appId>.*` → app
- [x] Structural ownership prevents namespace forgery (test confirms)
- [x] ContractError thrown with EVENT_UNKNOWN_TYPE on invalid input
- [x] Fixture re-namespaced from `room.created` to `core.room.activated` (fixes the rule contradiction)
- [x] 5th invalid case added to fixtures (type without namespace)
- [x] log-event.contract.spec.ts now runs 5 invalid cases and stays green
- [x] Exports added to index.ts in correct location
- [x] Tests all pass (39/39), lint clean, typecheck clean

### Quality
- Code follows existing patterns (visibility and error-codes modules as reference)
- Regex patterns in schemas are precise and documented
- TypeOwner union type is clear and discriminated
- Comments explain design intent (§4.1, namespace as namespace not as forgeable claim)
- No extraneous code, no YAGNI violations

### Discipline
- Followed TDD: RED → GREEN progression verified
- Fixture correction addresses the noted contradiction (phase-0 type that violated its own rule)
- All changes scoped to SDK package (leaf, no imports from core or other packages)
- CI gates: lint, typecheck, tests all green

### No Concerns
- Implementation is straightforward and correct
- All requirements from brief satisfied
- Test coverage is comprehensive (happy path, malformed types, error cases, namespace protection)
- Fixtures are now self-consistent with the ownership rule they test

## Files Changed

Absolute paths:
- `/Users/alexanderlapygin/Projects/mymozhem/packages/sdk/src/events/event-type.ts`
- `/Users/alexanderlapygin/Projects/mymozhem/packages/sdk/src/events/event-type.contract.spec.ts`
- `/Users/alexanderlapygin/Projects/mymozhem/packages/sdk/src/events/log-event.schema.ts`
- `/Users/alexanderlapygin/Projects/mymozhem/packages/sdk/src/events/log-event.fixtures.ts`
- `/Users/alexanderlapygin/Projects/mymozhem/packages/sdk/src/index.ts`

---

# Task 3 Fix Report: Compose event-type regexes from shared segments

## Finding addressed

Reviewer (Important, owner adjudicated: fix it): `appIdSchema`, `shortEventNameSchema` and
`eventTypeSchema` in `packages/sdk/src/events/event-type.ts` each hand-typed their own regex
literal, with `eventTypeSchema`'s pattern being `appIdSchema`'s namespace class + `\.` +
`shortEventNameSchema`'s pattern, retyped a third time. The compositional invariant — "an
accepted appId and an accepted short name always compose (via `composeEventType`) into an
accepted event type" — held only because the three copies happened to agree, not because
anything enforced agreement. No test exercised the composition itself, only fixed example
strings.

Note: the owner accepted a deliberate deviation from the plan's verbatim code for this fix;
this instruction, not the plan text, is binding for what follows.

## What changed and why

`packages/sdk/src/events/event-type.ts`:

- Introduced two module-level `const` string fragments (not `RegExp` objects, so they compose
  by string concatenation before a single `new RegExp(...)` call per schema):
  - `NAMESPACE_SEGMENT = '[a-z][a-z0-9-]*'` — the character class `appIdSchema` uses.
  - `NAME_SEGMENT = '[a-z][a-z0-9_-]*'` — the character class each dot-separated piece of a
    short name uses.
  - `SHORT_NAME_PATTERN = `${NAME_SEGMENT}(\\.${NAME_SEGMENT})*`` — the dotted-path pattern,
    itself built from `NAME_SEGMENT` rather than retyped.
- `appIdSchema` now regexes on `new RegExp(`^${NAMESPACE_SEGMENT}$`)`.
- `shortEventNameSchema` now regexes on `new RegExp(`^${SHORT_NAME_PATTERN}$`)`.
- `eventTypeSchema` now regexes on
  `new RegExp(`^${NAMESPACE_SEGMENT}\\.${SHORT_NAME_PATTERN}$`)` — literally
  "an appId, followed by a dot, followed by a short name" — built from the same two
  fragments as the other two schemas, not a fourth hand-typed pattern.

Each of the three resulting regex *sources* is character-for-character identical to what it
was before the refactor (verified by inspection: `^[a-z][a-z0-9-]*$`,
`^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$`, and
`^[a-z][a-z0-9-]*\.[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$` respectively) — this is a pure
refactor of *how* the pattern is written, not a change to what it accepts or rejects.

## Dead-branch decision

`resolveTypeOwner`'s `if (!appId.success)` branch (guarding `appIdSchema.safeParse(namespace)`
after `namespace !== CORE_NAMESPACE` has already been checked) is now provably unreachable:
`type` already matched `eventTypeSchema`, whose pattern opens with `^${NAMESPACE_SEGMENT}\.`;
`NAMESPACE_SEGMENT`'s character class contains no dot, so `type.indexOf('.')` finds exactly
the boundary after the namespace segment; therefore `namespace` necessarily matches
`appIdSchema`'s regex (the same `NAMESPACE_SEGMENT` source), and non-core was just checked.

**Decision: kept, with a comment**, rather than removed. Reasoning: this is a contract-boundary
function whose job under REQ-SEC-006 is to never let a raw validation error (message, stack)
leak past the SDK — only typed `ContractError` codes. The unreachability proof depends on
`eventTypeSchema` and `appIdSchema` continuing to share `NAMESPACE_SEGMENT`; if a future edit
touches one of the two independently and the shared-source discipline lapses, this branch is
the difference between a typed `EVENT_UNKNOWN_TYPE` and an unhandled `ZodError` escaping the
boundary. That is a cheap, load-bearing guard for a security/contract module, so I chose
defence-in-depth over deleting it. Added a comment at the branch stating exactly this — both
the proof of current unreachability and the reason it stays.

## Test added

`packages/sdk/src/events/event-type.contract.spec.ts`: a new `describe` block,
"composition invariant: an accepted appId + an accepted short name always compose into an
accepted, round-trippable event type", table-driven over 3 appIds (`quiz`, `app-2`, `a`) ×
3 short names (`answer_scored`, `answer.submitted`, `started`) = 9 cases. Each case asserts:

1. `appIdSchema.safeParse(appId).success === true`
2. `shortEventNameSchema.safeParse(shortName).success === true`
3. `eventTypeSchema.safeParse(composeEventType(appId, shortName)).success === true`
4. `resolveTypeOwner(composeEventType(appId, shortName))` equals
   `{ kind: 'app', appId, shortName }`

This is the test that would have caught the original drift: it exercises the compositional
relationship between the three schemas via `composeEventType`/`resolveTypeOwner`, not fixed
example strings, so a future edit to one character class that silently breaks agreement with
the other two fails here even if every pre-existing fixed-string assertion still passes.

## Tests run (exact commands and output)

### 1. `pnpm --filter @mymozhem/sdk exec jest src/events --verbose`
(note: `-v` is not a valid Jest CLI flag; `--verbose` is the equivalent and was used)

```
PASS src/events/event-type.contract.spec.ts
  event type ownership
    ✓ accepts a namespaced type: core.room.activated (1 ms)
    ✓ accepts a namespaced type: quiz.answer_scored
    ✓ accepts a namespaced type: quiz.answer.submitted
    ✓ rejects a malformed type: nodot
    ✓ rejects a malformed type: core.
    ✓ rejects a malformed type: .leading (1 ms)
    ✓ rejects a malformed type: Quiz.Answer
    ✓ rejects a malformed type: quiz..double
    ✓ resolves the core namespace to the core
    ✓ resolves any other namespace to the app that owns it
    ✓ rejects an unresolvable type with a typed error (3 ms)
    ✓ gives an app no way to declare into the core namespace
    ✓ reserves the core namespace against an app claiming it as its appId
    composition invariant: an accepted appId + an accepted short name always compose into an accepted, round-trippable event type
      ✓ appId=quiz, shortName=answer_scored (1 ms)
      ✓ appId=quiz, shortName=answer.submitted
      ✓ appId=quiz, shortName=started
      ✓ appId=app-2, shortName=answer_scored
      ✓ appId=app-2, shortName=answer.submitted
      ✓ appId=app-2, shortName=started
      ✓ appId=a, shortName=answer_scored
      ✓ appId=a, shortName=answer.submitted
      ✓ appId=a, shortName=started (1 ms)

PASS src/events/log-event.contract.spec.ts
  logEvent contract
    ✓ accepts valid fixture #0 (1 ms)
    ✓ accepts valid fixture #1 (4 ms)
    ✓ rejects invalid fixture: unknown visibility level
    ✓ rejects invalid fixture: missing seq
    ✓ rejects invalid fixture: negative seq
    ✓ rejects invalid fixture: non-uuid roomId
    ✓ rejects invalid fixture: event type without an owning namespace
    ✓ rejects a visibility level weaker than the declared enum

Test Suites: 2 passed, 2 total
Tests:       30 passed, 30 total
```

The phase-0 `log-event.contract.spec.ts` stayed green with its 5 invalid cases (including
"event type without an owning namespace"), confirming `eventTypeSchema`'s language did not
shift.

### 2. `pnpm --filter @mymozhem/sdk run lint`
```
$ eslint src
```
No output, no errors (exit 0).

### 3. `pnpm --filter @mymozhem/sdk run typecheck`
```
$ tsc -p tsconfig.json --noEmit
```
No output, no errors (exit 0).

### Full package suite (extra verification, not requested but run for confidence)
`pnpm --filter @mymozhem/sdk exec jest --verbose`:
```
Test Suites: 4 passed, 4 total
Tests:       48 passed, 48 total
```
(39 original + 9 new compositional-invariant cases = 48; no other suite regressed.)

## Confirmation: accepted/rejected language unchanged

- `appIdSchema`, `shortEventNameSchema`, `eventTypeSchema` regex *sources* are unchanged
  character-for-character from before the refactor (verified by inspection against the
  original literals).
- Every existing fixed-string test in `event-type.contract.spec.ts` (accept/reject cases,
  core-namespace resolution, app-namespace resolution, typed-error case, anti-forgery case,
  reserved-`core`-appId case) still passes unmodified.
- `log-event.contract.spec.ts`'s 5 invalid-fixture cases, which exercise `eventTypeSchema`
  through `logEventSchema.type`, still pass unmodified.
- No test was edited to make it pass; all pre-existing tests pass as originally written.

## Files changed

- `/Users/alexanderlapygin/Projects/mymozhem/packages/sdk/src/events/event-type.ts`
- `/Users/alexanderlapygin/Projects/mymozhem/packages/sdk/src/events/event-type.contract.spec.ts`
