# Task 9 Report — Authoring helper and the fail-closed conversion guard

## What was implemented

Three new files under `packages/sdk/src/manifest/`, plus two new export lines in `packages/sdk/src/index.ts`, following the brief verbatim:

- **`define-app.fixtures.ts`** — `representableSchemas` (5 cases) and `unrepresentableSchemas` (7 cases), copied verbatim from the brief's Step 1.
- **`define-app.contract.spec.ts`** — 23 tests across two `describe` blocks (`conversion guard`, `defineApp`), copied verbatim from the brief's Step 1.
- **`define-app.ts`** — `type AppDefinition`, `toRegisteredSchema(schema: z.ZodType): JsonSchemaObject`, `defineApp(definition: AppDefinition): AppManifest`, copied verbatim from the brief's Step 3.
- **`index.ts`** — appended `export * from './manifest/define-app';` and `export * from './manifest/define-app.fixtures';` after the existing `export * from './manifest/app-settings-visibility';` line. The file's pre-existing export order (`core-events` sits right after `event-type`, not after `projected-event.fixtures` as the brief's "finished index.ts in full" shows) was left untouched — order is irrelevant for `export *` re-exports, and the brief's own instructions were to reconcile against what's actually there and append, not to drop or reorder an existing export.

`toRegisteredSchema` converts an app-authored zod schema to its JSON Schema snapshot via `z.toJSONSchema`, using the `override` hook (which walks every subschema, including nested ones and ones inside arrays) to detect a `.refine()`/`.superRefine()` by the zod-internal discriminator `_zod.def.checks[].{_zod.def.check === 'custom'}`, throwing a typed `ContractError('SCHEMA_NOT_REPRESENTABLE', …)` the instant one is found. Anything zod itself throws on (`z.date()`, `z.bigint()`, `.transform()`) is caught and re-wrapped as the same typed code, so no raw zod error/message ever crosses the guard (REQ-SEC-006). `defineApp` calls `toRegisteredSchema` on `appSettings` and on every event's schema, runs `assertVisibilityAnnotations` (Task 8) on the settings snapshot, defaults `contractRange` to `` `^${CONTRACT_VERSION}` `` when omitted, assembles the manifest object, and validates it through `appManifestSchema.safeParse`, re-wrapping any zod parse failure as `ContractError('MANIFEST_INVALID', …)`.

## What was tested, and results

Focused suite: `pnpm --filter @mymozhem/sdk exec jest src/manifest/define-app --verbose` → **23/23 passing** (see TDD Evidence below for the full listing).

Full gate run (Step 6), verbatim as specified:

```
pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build && pnpm run boundary-check && pnpm run guardrails
```

Result — all green:

- `typecheck` — 5/5 tasks successful (sdk, core, server).
- `lint` — 3/3 tasks successful (sdk cache miss/clean, core+server cache hit).
- `test` — 5/5 tasks successful. `@mymozhem/sdk:test`: **10 suites, 123 tests, all passing** (includes the new `define-app.contract.spec.ts` at 23 tests). `@mymozhem/core:test`: 2 suites, 6 tests passing. `@mymozhem/server:test`: 1 suite, 3 tests passing.
- `build` — 3/3 tasks successful.
- `boundary-check` — `depcruise apps packages --config .dependency-cruiser.cjs` → `✔ no dependency violations found (123 modules, 240 dependencies cruised)`. SDK remains a leaf.
- `guardrails` — `node scripts/verify-guardrails.mjs` →
  ```
  OK   — guardrail fired on: sdk → core import (dependency-cruiser)
  OK   — guardrail fired on: module-level mutable export (eslint)
  OK   — guardrail fired on: apps → core src-internals import (dependency-cruiser)

  All guardrails verified alive.
  ```

## TDD Evidence

**RED** — command: `pnpm --filter @mymozhem/sdk exec jest src/manifest/define-app --verbose` (run with `--verbose`, not `-v`, per the known Jest 29.7.0 argv defect noted in the task instructions), run immediately after writing `define-app.fixtures.ts` and `define-app.contract.spec.ts` but before `define-app.ts` existed:

```
FAIL src/manifest/define-app.contract.spec.ts
  ● Test suite failed to run

    src/manifest/define-app.contract.spec.ts:6:47 - error TS2307: Cannot find module './define-app' or its corresponding type declarations.

    6 import { defineApp, toRegisteredSchema } from './define-app';

Test Suites: 1 failed, 1 total
Tests:       0 total
```

This is exactly the expected failure per the brief's Step 2 (`Cannot find module './define-app'`) — a genuine "the implementation doesn't exist yet" RED, not an argv-parsing false failure.

**GREEN** — same command, run after writing `define-app.ts`:

```
PASS src/manifest/define-app.contract.spec.ts
  conversion guard
    ✓ converts a legal schema: string bounds and regex
    ✓ converts a legal schema: integer bounds
    ✓ converts a legal schema: enum and optional
    ✓ converts a legal schema: nested object and array
    ✓ converts a legal schema: visibility annotation
    ✓ refuses a schema that would not survive conversion: top-level .refine()
    ✓ refuses a schema that would not survive conversion: nested .refine()
    ✓ refuses a schema that would not survive conversion: .refine() inside an array
    ✓ refuses a schema that would not survive conversion: .superRefine()
    ✓ refuses a schema that would not survive conversion: z.date()
    ✓ refuses a schema that would not survive conversion: z.bigint()
    ✓ refuses a schema that would not survive conversion: .transform()
    ✓ still detects that zod drops .refine() silently
    ✓ keeps the checks that DO convert
  defineApp
    ✓ produces a manifest that satisfies the manifest contract
    ✓ defaults contractRange to the current major of the contract
    ✓ keeps an explicit contractRange
    ✓ registers events under short names and carries their ceiling
    ✓ snapshots appSettings with visibility annotations intact (ADR-008)
    ✓ produces a JSON-serializable manifest with no live objects in it
    ✓ refuses an app that would take the core namespace
    ✓ refuses an unrepresentable event schema with a typed error
    ✓ refuses a misspelled visibility annotation

Test Suites: 1 passed, 1 total
Tests:       23 passed, 23 total
```

Matches the brief's Step 4 expectation exactly (PASS, 23 tests).

## Empirics check

Before implementing, I re-ran zod 4.4.3 (confirmed installed version: `packages/sdk/node_modules/zod/package.json` → `"version": "4.4.3"`) directly, from a script placed inside `packages/sdk` (module resolution requires this — running from `/tmp` fails with `Cannot find package 'zod'`). All four rows of the brief's table were reproduced exactly:

| Construct | Observed |
|---|---|
| top-level `.refine()` | `z.toJSONSchema` returned successfully, no `refine` anywhere in the output — silent drop |
| nested `.refine()` (inside `inner`) | same — silent drop, no throw |
| `.refine()` inside `z.array(...)` | same — silent drop, no throw |
| `.superRefine()` | same — silent drop, no throw |
| `z.date()` | threw `Date cannot be represented in JSON Schema` |
| `z.bigint()` | threw `BigInt cannot be represented in JSON Schema` |
| `.transform()` | threw `Transforms cannot be represented in JSON Schema` |
| `.min(1)` discriminator | `_zod.def.checks` → `["min_length"]` |
| `.refine()` discriminator | `_zod.def.checks` → `["custom"]` |
| `override` hook tree walk | called once per subschema, 5 times for a 2-level nested object (`ZodObject`, `ZodNumber` ×2, `ZodObject` ×2) — confirms it walks nested shapes without a hand-rolled recursive walker |
| `.meta({ 'x-visibility': ... })` | survived conversion both with and without an `override` supplied |

One thing verified beyond the brief's table, because the brief's fixture includes `.superRefine()` as a case the guard must catch and the table only explicitly names `.refine()`/`.superRefine()` together: I confirmed directly that `.superRefine()` also populates `_zod.def.checks` with `check === 'custom'`, and that `hasCustomCheck` + the `override` hook catches it exactly like `.refine()` (top-level, nested, and inside an array). No discrepancy from the brief's table was found — the implementation was written using the brief's Step 3 code verbatim, and the empirics matched, so no adjustment was needed.

## Files changed

- Created: `/Users/alexanderlapygin/Projects/mymozhem/packages/sdk/src/manifest/define-app.ts`
- Created: `/Users/alexanderlapygin/Projects/mymozhem/packages/sdk/src/manifest/define-app.fixtures.ts`
- Created: `/Users/alexanderlapygin/Projects/mymozhem/packages/sdk/src/manifest/define-app.contract.spec.ts`
- Modified: `/Users/alexanderlapygin/Projects/mymozhem/packages/sdk/src/index.ts` (two lines appended)

Commit: `730d646` — `feat(sdk): zod authoring surface with fail-closed conversion guard (REQ-CTR-008, ADR-006, ADR-008)`

## Self-review findings

- **Naming/pattern consistency**: `define-app.contract.spec.ts` follows the `*.contract.spec.ts` naming convention used by every other spec in `packages/sdk/src/manifest/` (`app-settings-visibility.contract.spec.ts`, `manifest.contract.spec.ts`). Comment style (design/REQ/ADR references inline) matches `app-settings-visibility.ts` and `manifest.schema.ts`.
- **No overbuilding**: `toRegisteredSchema` and `defineApp` do exactly what the brief specifies — no extra options, no speculative parameters, no `capabilities` field, no rewards scaffolding. `AppDefinition` has exactly the fields the brief lists.
- **No module-level mutable state**: only `const` at module level throughout; confirmed the ESLint `no-restricted-syntax` rule for `let`/`var` passed clean.
- **Type safety of the zod-internal read**: `hasCustomCheck` casts through `unknown`-based helper types (`ZodInternals`, `CheckInternals`) rather than `any`, so the internals access is narrow and typechecked; passed `tsc --noEmit` with no `any`-related lint suppression needed.
- **Export ordering in `index.ts`**: verified no naming collisions exist between the new exports (`AppDefinition`, `toRegisteredSchema`, `defineApp`, `representableSchemas`, `unrepresentableSchemas`) and anything already exported elsewhere in the package — confirmed via grep and via a clean `build`/`typecheck` (a collision would have been a compile error).
- **Test output pristine**: no `.only`/`.skip`, no stray `console.*`, no `TODO`/`FIXME` in any of the three new files (checked via grep).
- No changes needed after self-review — everything held on first pass.

## Issues or concerns

None. All empirics matched the brief exactly, all 23 focused tests and all 6 CI gates are green, `guardrails` prints the required line, and the commit message matches the brief verbatim. This closes the SDK-contract-core plan (Task 9 of 9).

---

# Fix pass — review findings (2026-07-17)

Owner adjudicated Finding 1 against the plan's verbatim Step 3 code: the `hasCustomCheck` denylist (rejects only `check === 'custom'`) is fail-open to any other check kind zod drops silently, and empirically zod 4.4.3 has one such kind today — `overwrite` (`.trim()`, `.toLowerCase()`, …). Fixed by inverting to an allowlist of representable check kinds. Findings 2–4 (minor) fixed in the same files.

## Finding 1 — denylist → allowlist (`define-app.ts`)

**The hole, reproduced on zod 4.4.3 in this checkout** (same table as the original report, extended):

```
z.string().trim().min(1)   | checks: ["overwrite","min_length"] | json: {"type":"string","minLength":1}
z.string().toLowerCase()   | checks: ["overwrite"]              | json: {"type":"string"}
```

`hasCustomCheck` only matched `check === 'custom'`, so an `overwrite` check passed the guard and was silently dropped from the JSON Schema snapshot — the same defect class ADR-008 exists to prevent (app believes a rule is enforced; core never received it), and internally inconsistent with the guard already rejecting `.transform()`, which `.trim()`/`.toLowerCase()` are functionally equivalent to.

**Change:** `hasCustomCheck` → `hasUnrepresentableCheck`, driven by a module-level `const` allowlist `REPRESENTABLE_CHECK_KINDS = new Set(['min_length', 'max_length', 'string_format', 'number_format', 'greater_than', 'less_than', 'multiple_of'])`. A check whose kind is not in the set is now refused, not just `'custom'`. This is fail-closed by construction: an unrecognized future zod check kind is refused rather than silently admitted. The comment above the set explains both halves of the reasoning — why `.min(1)` (→ `min_length`) must stay legal, and why unknown kinds (not just `'custom'`) are refused. The "conversion guard" comment block and the thrown message were both updated to mention `overwrite` alongside `.refine()/.superRefine()`.

Two fixtures added to `unrepresentableSchemas` in `define-app.fixtures.ts`, exactly as specified:
- `'string .trim() (overwrite check, dropped silently)'` — `z.object({ s: z.string().trim().min(1) })`
- `'string .toLowerCase() (overwrite check, dropped silently)'` — `z.object({ s: z.string().toLowerCase() })`

### Reproduction: RED against the old (denylist) guard

Command: `pnpm --filter @mymozhem/sdk exec jest src/manifest/define-app --verbose`, run immediately after adding the two fixtures, before touching `define-app.ts`:

```
    ✕ refuses a schema that would not survive conversion: string .trim() (overwrite check, dropped silently)
    ✕ refuses a schema that would not survive conversion: string .toLowerCase() (overwrite check, dropped silently)

  ● conversion guard › refuses a schema that would not survive conversion: string .trim() (overwrite check, dropped silently)

    expect(received).toThrow(expected)

    Expected constructor: ContractError

    Received function did not throw

  ● conversion guard › refuses a schema that would not survive conversion: string .toLowerCase() (overwrite check, dropped silently)

    expect(received).toThrow(expected)

    Expected constructor: ContractError

    Received function did not throw

Test Suites: 1 failed, 1 total
Tests:       2 failed, 23 passed, 25 total
```

This is the hole reproduced: the old guard let both `.trim()` and `.toLowerCase()` schemas through unrefused.

### Reproduction: GREEN against the new (allowlist) guard

Same command, after the `hasUnrepresentableCheck`/allowlist change:

```
    ✓ refuses a schema that would not survive conversion: string .trim() (overwrite check, dropped silently)
    ✓ refuses a schema that would not survive conversion: string .toLowerCase() (overwrite check, dropped silently)

Test Suites: 1 passed, 1 total
Tests:       25 passed, 25 total
```

### Check kinds the five `representableSchemas` fixtures actually produce

Measured directly (walked `_zod.def.checks` over each fixture's full shape, including nested objects/arrays) on zod 4.4.3 in this checkout:

| Fixture | Check kinds produced |
|---|---|
| `string bounds and regex` (`z.string().min(1).max(32)`, `z.string().regex(...)`) | `min_length`, `max_length`, `string_format` |
| `integer bounds` (`z.number().int().min(0).max(3)`) | `number_format`, `greater_than`, `less_than` |
| `enum and optional` | (none) |
| `nested object and array` | (none) |
| `visibility annotation` (`.meta(...)`) | (none) |

All produced kinds — `min_length`, `max_length`, `string_format`, `number_format`, `greater_than`, `less_than` — are members of the given seven-kind allowlist (`multiple_of` is in the allowlist but not exercised by any current fixture; it is a legitimate representable kind per the owner's list, included for completeness/future `.step()`/`.multipleOf()` authoring). **No widening of the allowlist was needed.** Confirmed passing: all five `it.each` cases under `converts a legal schema: %s` pass unchanged in both the RED and GREEN runs above (23 passed / 25 passed respectively — the representable-schema tests never moved).

## Finding 2 — near-vacuous assertion (`define-app.contract.spec.ts`, `still detects that zod drops .refine() silently`)

Replaced `expect(converted).not.toContain('refine')` (would pass even if zod started representing refinements under any keyword other than the literal string `'refine'`) with an equality check against the same schema without the refinement:

```ts
const bare = z.object({ a: z.number(), b: z.number() });
const refined = bare.refine((v) => v.a < v.b);

expect(JSON.stringify(z.toJSONSchema(refined))).toBe(JSON.stringify(z.toJSONSchema(bare)));
expect(() => toRegisteredSchema(refined)).toThrow(ContractError);
```

This asserts the refinement leaves literally no trace in zod's own output (identical to the un-refined schema), under whatever keyword zod might use — a real premise check for the fixture that guards the guard.

## Finding 3 — try/catch → single assertion (`define-app.contract.spec.ts`, `unrepresentableSchemas` `it.each`)

Replaced the two-call try/catch (second call re-invoked `toRegisteredSchema`, and the `.code` assertion sat inside `catch`, silently skipped if nothing threw) with:

```ts
expect(() => toRegisteredSchema(schema)).toThrow(
  expect.objectContaining({ code: 'SCHEMA_NOT_REPRESENTABLE' }),
);
```

Checked the rest of the file (`grep -n "try {"`) for sibling occurrences of the same pattern — there were none; this was the only one.

## Finding 4 — pointless spread (`define-app.ts:78`)

`return { ...json } as JsonSchemaObject;` → `return json as JsonSchemaObject;`. `json` is a fresh object `z.toJSONSchema` just built; the spread copied it for no reason.

## Covering tests re-run (post-fix)

Command: `pnpm --filter @mymozhem/sdk exec jest src/manifest/define-app --verbose`

```
PASS src/manifest/define-app.contract.spec.ts
  conversion guard
    ✓ converts a legal schema: string bounds and regex (1 ms)
    ✓ converts a legal schema: integer bounds
    ✓ converts a legal schema: enum and optional
    ✓ converts a legal schema: nested object and array
    ✓ converts a legal schema: visibility annotation
    ✓ refuses a schema that would not survive conversion: top-level .refine() (4 ms)
    ✓ refuses a schema that would not survive conversion: nested .refine()
    ✓ refuses a schema that would not survive conversion: .refine() inside an array
    ✓ refuses a schema that would not survive conversion: .superRefine()
    ✓ refuses a schema that would not survive conversion: z.date() (1 ms)
    ✓ refuses a schema that would not survive conversion: z.bigint()
    ✓ refuses a schema that would not survive conversion: .transform()
    ✓ refuses a schema that would not survive conversion: string .trim() (overwrite check, dropped silently)
    ✓ refuses a schema that would not survive conversion: string .toLowerCase() (overwrite check, dropped silently)
    ✓ still detects that zod drops .refine() silently (1 ms)
    ✓ keeps the checks that DO convert
  defineApp
    ✓ produces a manifest that satisfies the manifest contract (2 ms)
    ✓ defaults contractRange to the current major of the contract
    ✓ keeps an explicit contractRange
    ✓ registers events under short names and carries their ceiling (1 ms)
    ✓ snapshots appSettings with visibility annotations intact (ADR-008)
    ✓ produces a JSON-serializable manifest with no live objects in it
    ✓ refuses an app that would take the core namespace (1 ms)
    ✓ refuses an unrepresentable event schema with a typed error
    ✓ refuses a misspelled visibility annotation (1 ms)

Test Suites: 1 passed, 1 total
Tests:       25 passed, 25 total
```

## Full gate run (post-fix)

Command: `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build && pnpm run boundary-check && pnpm run guardrails`

- `typecheck` — 5/5 tasks successful.
- `lint` — 3/3 tasks successful (sdk cache miss/clean, core+server cache hit).
- `test` — 5/5 tasks successful. `@mymozhem/sdk:test`: **10 suites, 125 tests, all passing** (123 prior + 2 new overwrite fixtures). `@mymozhem/core:test`: 2 suites, 6 tests. `@mymozhem/server:test`: 1 suite, 3 tests.
- `build` — 3/3 tasks successful.
- `boundary-check` — `depcruise apps packages --config .dependency-cruiser.cjs` → `✔ no dependency violations found (123 modules, 240 dependencies cruised)`.
- `guardrails` — `node scripts/verify-guardrails.mjs`:
  ```
  OK   — guardrail fired on: sdk → core import (dependency-cruiser)
  OK   — guardrail fired on: module-level mutable export (eslint)
  OK   — guardrail fired on: apps → core src-internals import (dependency-cruiser)

  All guardrails verified alive.
  ```

## Self-review

- **Scope discipline**: only the three named files touched; `manifest.schema.ts` untouched, no other findings introduced, no forward scaffolding (allowlist has exactly the seven kinds given, not a speculative superset).
- **No module-level mutable state**: `REPRESENTABLE_CHECK_KINDS` is a module-level `const Set` — explicitly permitted by the constraint.
- **Typed error code unchanged**: guard still throws `ContractError('SCHEMA_NOT_REPRESENTABLE', …)` — only the message text and the discriminator changed, not the code.
- **`ContractError` import still used** in the spec file (line 60's `toThrow(ContractError)`, plus the `defineApp` describe block's three `toThrow(ContractError)` calls, which are not the try/catch pattern Finding 3 targeted and were left alone).
- **Comment fidelity**: the `.min(1)` → `min_length` reasoning from the original comment survives verbatim in substance in the new comment above `REPRESENTABLE_CHECK_KINDS`; the new half (why unknown kinds are refused, denylist-vs-allowlist tradeoff) was added alongside it, not instead of it.
- **No fixture weakened**: all five `representableSchemas` fixtures are byte-for-byte unchanged from the original commit; none needed adjustment for the new allowlist to pass.
- No issues found on self-review; nothing bent to make the suite green.

## Allowlist widening

Not needed. All check kinds produced by the five `representableSchemas` fixtures (`min_length`, `max_length`, `string_format`, `number_format`, `greater_than`, `less_than`) are within the seven-kind allowlist given in the brief. `multiple_of` was included per the brief but not exercised by any existing fixture.

---

# Second fix pass — re-review findings (2026-07-17)

Three findings from the re-review of the first fix pass, all in the three files this task owns (`define-app.ts`, `define-app.fixtures.ts`, `define-app.contract.spec.ts`). No other files touched.

## Finding 1 (Important) — `length_equals` missing from the allowlist

The owner ran the trace test (convert a base schema with a given check kind applied vs. without it, compare `z.toJSONSchema` output) across 25 constructs on zod 4.4.3 in this checkout. Result: eight check kinds leave a trace (representable) — `min_length`, `max_length`, `length_equals`, `string_format`, `number_format`, `greater_than`, `less_than`, `multiple_of` — and two leave none (silent loss, must stay refused) — `custom` (`.refine()`/`.superRefine()`), `overwrite` (`.trim()`/`.toLowerCase()`/…). The seven-kind allowlist from the first fix pass was missing `length_equals`, so `.length()` — a plausible authoring construct in this project's domain (fixed-length room code, PIN, fixed-size answer array) — was refused even though it converts losslessly:

```
z.string().length(5)          -> {"type":"string","minLength":5,"maxLength":5}
z.array(z.string()).length(3) -> {"type":"array","minItems":3,"maxItems":3,...}
```

**Change in `define-app.ts`:** added `'length_equals'` to `REPRESENTABLE_CHECK_KINDS`, giving the eight-kind list in the order the derivation table lists them. Rewrote the comment above the set to state that the list is DERIVED by the trace test just described — convert with and without each check kind, compare outputs, a trace means representable — rather than enumerated by hand, and to name the method as something a future reader re-runs before adding or removing a kind. The pre-existing `.min(1)` → `min_length` reasoning (why a naive "checks array is non-empty ⇒ reject" guard would wrongly reject ordinary bounded strings) was kept verbatim as the first paragraph; the new paragraph was appended after it, not substituted for it.

**Change in `define-app.fixtures.ts`:** added two cases to `representableSchemas`, one string and one array, per the instruction that the kind must be pinned by a fixture:

```ts
{ name: 'string .length() (fixed-length code, e.g. a room code)', schema: z.object({ code: z.string().length(6) }) },
{ name: 'array .length() (fixed-size answer array)', schema: z.object({ answers: z.array(z.string()).length(3) }) },
```

### Reproduction: the two fixtures fail against the seven-kind allowlist

Command: `pnpm --filter @mymozhem/sdk exec jest src/manifest/define-app --verbose`, run immediately after adding the two fixtures to `define-app.fixtures.ts`, before touching the allowlist in `define-app.ts`:

```
  ● conversion guard › converts a legal schema: string .length() (fixed-length code, e.g. a room code)

    expect(received).not.toThrow()

    Error name:    "ContractError"
    Error message: "check cannot be represented in JSON Schema and would be dropped silently (e.g. .refine/.superRefine, or an overwrite check such as .trim()/.toLowerCase())"

  ● conversion guard › converts a legal schema: array .length() (fixed-size answer array)

    expect(received).not.toThrow()

    Error name:    "ContractError"
    Error message: "check cannot be represented in JSON Schema and would be dropped silently (e.g. .refine/.superRefine, or an overwrite check such as .trim()/.toLowerCase())"

Test Suites: 1 failed, 1 total
Tests:       2 failed, 25 passed, 27 total
```

This is the false positive reproduced: `.length()` schemas, which convert losslessly, were being refused by the seven-kind allowlist.

### Reproduction: the same two fixtures pass against the eight-kind allowlist

Same command, after adding `'length_equals'` to `REPRESENTABLE_CHECK_KINDS`:

```
    ✓ converts a legal schema: string .length() (fixed-length code, e.g. a room code)
    ✓ converts a legal schema: array .length() (fixed-size answer array)

Test Suites: 1 passed, 1 total
Tests:       27 passed, 27 total
```

## Finding 2 (Minor) — refusal message couldn't name what it refused

`define-app.ts:71-74` (pre-fix) carried a fixed example list (`e.g. .refine/.superRefine, or an overwrite check such as .trim()/.toLowerCase()`) that would be wrong for any kind not named — exactly the case hardest to diagnose (a future zod check kind the guard correctly refuses but can't explain).

**Change:** split the old boolean `hasUnrepresentableCheck` into `findUnrepresentableCheckKind`, which returns the offending kind string (or `undefined` if the schema's checks are all on the allowlist) instead of a boolean, and interpolated it into the thrown message:

```ts
const findUnrepresentableCheckKind = (schema: unknown): string | undefined => {
  const checks = (schema as ZodInternals)?._zod?.def?.checks ?? [];
  for (const check of checks) {
    const kind = (check as CheckInternals)?._zod?.def?.check;
    if (!REPRESENTABLE_CHECK_KINDS.has(kind ?? '')) {
      return kind ?? '(unknown check kind)';
    }
  }
  return undefined;
};
```

```ts
throw new ContractError(
  'SCHEMA_NOT_REPRESENTABLE',
  `check kind '${unrepresentableKind}' cannot be represented in JSON Schema and would be dropped silently (not in the allowlist of check kinds known to convert intact, e.g. .refine/.superRefine ('custom'), or an overwrite check such as .trim()/.toLowerCase() ('overwrite'))`,
);
```

This only touches the authoring-time message thrown by `toRegisteredSchema`; `ContractError.toPayload()` (REQ-SEC-006, unmodified) still emits the code alone outward, so no additional information leaves the boundary — this is a DX improvement for the app author calling `defineApp`/`toRegisteredSchema` directly, not a change to what the core receives over the wire.

**Manual verification** (temporary scratch spec, written to `packages/sdk/src/manifest/__scratch_verify__.spec.ts`, run, then deleted before commit — not part of the delivered diff):

```
REFINE MESSAGE: check kind 'custom' cannot be represented in JSON Schema and would be dropped silently (not in the allowlist of check kinds known to convert intact, e.g. .refine/.superRefine ('custom'), or an overwrite check such as .trim()/.toLowerCase() ('overwrite'))
TRIM MESSAGE: check kind 'overwrite' cannot be represented in JSON Schema and would be dropped silently (not in the allowlist of check kinds known to convert intact, e.g. .refine/.superRefine ('custom'), or an overwrite check such as .trim()/.toLowerCase() ('overwrite'))
LENGTH RESULT: {"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"code":{"type":"string","minLength":6,"maxLength":6}},"required":["code"],"additionalProperties":false}
```

Confirms the message names `'custom'` for `.refine()` and `'overwrite'` for `.trim()` — the two silent-loss kinds — and that `.length(6)` converts to the expected `minLength`/`maxLength` pair.

## Finding 3 (Minor) — `it.each` dropped its error-class assertion

`define-app.contract.spec.ts` — the `unrepresentableSchemas` `it.each` asserted only `toThrow(expect.objectContaining({ code: 'SCHEMA_NOT_REPRESENTABLE' }))`, which a plain thrown object (not a `ContractError`) would also satisfy.

**Change:** chained the class assertion back in ahead of the code assertion:

```ts
expect(() => toRegisteredSchema(schema)).toThrow(ContractError);
expect(() => toRegisteredSchema(schema)).toThrow(
  expect.objectContaining({ code: 'SCHEMA_NOT_REPRESENTABLE' }),
);
```

Both calls re-invoke `toRegisteredSchema(schema)` independently (the same pattern already used elsewhere in this file, e.g. the `defineApp` describe block's `toThrow(ContractError)` calls) — `toRegisteredSchema` is a pure function of its argument with no shared mutable state between calls, so re-invoking it twice per case asserts the same failure twice, not two different runs.

## Confirmation: silent-loss fixtures still refused

From the GREEN run above (27 passed / 27 total), both overwrite-check fixtures from the first fix pass and both custom-check fixtures remain refused:

```
✓ refuses a schema that would not survive conversion: top-level .refine()
✓ refuses a schema that would not survive conversion: nested .refine()
✓ refuses a schema that would not survive conversion: .refine() inside an array
✓ refuses a schema that would not survive conversion: .superRefine()
✓ refuses a schema that would not survive conversion: string .trim() (overwrite check, dropped silently)
✓ refuses a schema that would not survive conversion: string .toLowerCase() (overwrite check, dropped silently)
```

The Finding 1 fix (admitting `length_equals`) did not reopen the hole the first fix pass closed (admitting only `custom`/`overwrite` implicitly by omission would have).

## Covering tests re-run (final)

Command: `pnpm --filter @mymozhem/sdk exec jest src/manifest/define-app --verbose`

```
PASS src/manifest/define-app.contract.spec.ts
  conversion guard
    ✓ converts a legal schema: string bounds and regex (1 ms)
    ✓ converts a legal schema: integer bounds
    ✓ converts a legal schema: enum and optional
    ✓ converts a legal schema: nested object and array
    ✓ converts a legal schema: visibility annotation
    ✓ converts a legal schema: string .length() (fixed-length code, e.g. a room code) (1 ms)
    ✓ converts a legal schema: array .length() (fixed-size answer array)
    ✓ refuses a schema that would not survive conversion: top-level .refine() (4 ms)
    ✓ refuses a schema that would not survive conversion: nested .refine()
    ✓ refuses a schema that would not survive conversion: .refine() inside an array
    ✓ refuses a schema that would not survive conversion: .superRefine()
    ✓ refuses a schema that would not survive conversion: z.date()
    ✓ refuses a schema that would not survive conversion: z.bigint()
    ✓ refuses a schema that would not survive conversion: .transform() (1 ms)
    ✓ refuses a schema that would not survive conversion: string .trim() (overwrite check, dropped silently)
    ✓ refuses a schema that would not survive conversion: string .toLowerCase() (overwrite check, dropped silently)
    ✓ still detects that zod drops .refine() silently (1 ms)
    ✓ keeps the checks that DO convert
  defineApp
    ✓ produces a manifest that satisfies the manifest contract (2 ms)
    ✓ defaults contractRange to the current major of the contract
    ✓ keeps an explicit contractRange (1 ms)
    ✓ registers events under short names and carries their ceiling (7 ms)
    ✓ snapshots appSettings with visibility annotations intact (ADR-008) (1 ms)
    ✓ produces a JSON-serializable manifest with no live objects in it
    ✓ refuses an app that would take the core namespace
    ✓ refuses an unrepresentable event schema with a typed error (1 ms)
    ✓ refuses a misspelled visibility annotation

Test Suites: 1 passed, 1 total
Tests:       27 passed, 27 total
Snapshots:   0 total
Time:        0.421 s, estimated 1 s
```

## Full gate run (final)

Command: `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build && pnpm run boundary-check && pnpm run guardrails`

- `typecheck` — 5/5 tasks successful.
- `lint` — 3/3 tasks successful (sdk cache miss, core+server cache hit).
- `test` — 5/5 tasks successful. `@mymozhem/sdk:test`: **10 suites, 127 tests, all passing** (125 prior + 2 new `.length()` fixtures). `@mymozhem/core:test`: 2 suites, 6 tests. `@mymozhem/server:test`: 1 suite, 3 tests.
- `build` — 3/3 tasks successful.
- `boundary-check` — `depcruise apps packages --config .dependency-cruiser.cjs` → `✔ no dependency violations found (123 modules, 240 dependencies cruised)`.
- `guardrails` — `node scripts/verify-guardrails.mjs`:
  ```
  OK   — guardrail fired on: sdk → core import (dependency-cruiser)
  OK   — guardrail fired on: module-level mutable export (eslint)
  OK   — guardrail fired on: apps → core src-internals import (dependency-cruiser)

  All guardrails verified alive.
  ```

## Self-review

- **Scope discipline**: `git status --porcelain` after the commit shows a clean tree; `git show --stat` on the commit touches exactly the three files this task owns. `manifest.schema.ts` untouched.
- **Derivation table checked, not assumed**: the temporary scratch spec (deleted before commit) independently confirmed `.refine()` produces `'custom'`, `.trim()` produces `'overwrite'`, and `.length(6)` converts to `{"type":"string","minLength":6,"maxLength":6}` on zod 4.4.3 in this checkout — matching every row of the derivation table relevant to this fix. No discrepancy found; nothing in the table needed correction.
- **No module-level mutable state**: `REPRESENTABLE_CHECK_KINDS` stays a module-level `const Set`; `findUnrepresentableCheckKind` is a pure function, no new module-level state introduced.
- **Typed error code unchanged**: still throws `ContractError('SCHEMA_NOT_REPRESENTABLE', …)` — only the message text and the internal helper's return type (`boolean` → `string | undefined`) changed.
- **No forward scaffolding**: did not rewrite the guard to derive representability at runtime from zod's own metadata; the allowlist is still a static `Set` plus fixtures, exactly the decided design — only the list's membership and the comment describing how it was arrived at changed.
- **REQ-SEC-006 respected**: the interpolated message is thrown by `toRegisteredSchema`/surfaces through `ContractError.message`, an authoring-time detail; `ContractError.toPayload()` (untouched) still emits the code alone outward.
- **Fixture naming convention**: the two new fixtures follow the existing `{ name: '<description>', schema: ... }` shape and single-line style already used for every other entry in `define-app.fixtures.ts`.
- **Scratch verification file removed**: `packages/sdk/src/manifest/__scratch_verify__.spec.ts`, created to observe the exact thrown message text and the `.length()` conversion output, was deleted before staging/committing — `git status --porcelain` confirms it is not present and not tracked.
- No issues found; no test was weakened or bent to reach green.
