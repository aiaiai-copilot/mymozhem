## Task 9: Authoring helper and the fail-closed conversion guard

**Files:**
- Create: `packages/sdk/src/manifest/define-app.ts`, `packages/sdk/src/manifest/define-app.fixtures.ts`, `packages/sdk/src/manifest/define-app.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `type AppDefinition`, `toRegisteredSchema(schema: z.ZodType): JsonSchemaObject`, `defineApp(definition: AppDefinition): AppManifest`.
- Consumes: `ContractError` (Task 2), `CONTRACT_VERSION` (Task 6), `appManifestSchema`/`AppManifest`/`JsonSchemaObject` (Task 7), `assertVisibilityAnnotations` (Task 8), `Visibility` (Task 1).

**The empirics this task rests on** (re-verified by running zod 4.4.3 on 2026-07-16, not taken from documentation or memory — design §3):

| Construct | `z.toJSONSchema` behaviour | Guard's job |
|---|---|---|
| `.refine()` / `.superRefine()` | **dropped silently**, no error, no warning — nested and inside arrays too | detect and reject |
| `z.date()`, `z.bigint()`, `.transform()` | throws | re-wrap as a typed code |
| `.min()`, `.max()`, `.regex()`, `.int()`, enums | converted correctly | leave alone |
| `.meta({ 'x-visibility': … })` | survives, also with an `override` supplied | leave alone |

Detection detail that decides the implementation: a `.refine()` lives in `_zod.def.checks` with `check === 'custom'`, whereas `.min(1)` also puts a check there but with `check === 'min_length'`. **The discriminator is `check === 'custom'`, not a non-empty `checks` array** — the latter would reject perfectly legal schemas. The `override` hook is called for every subschema, including nested ones and ones inside arrays, so it performs the tree walk; a hand-rolled recursive walk is unnecessary and would miss shapes.

- [ ] **Step 1: Write the failing test** — `packages/sdk/src/manifest/define-app.fixtures.ts`

```ts
import { z } from 'zod';

// Schemas an app may legally author: everything here survives conversion intact.
export const representableSchemas: { name: string; schema: z.ZodType }[] = [
  { name: 'string bounds and regex', schema: z.object({ nick: z.string().min(1).max(32), code: z.string().regex(/^[A-Z]+$/) }) },
  { name: 'integer bounds', schema: z.object({ choice: z.number().int().min(0).max(3) }) },
  { name: 'enum and optional', schema: z.object({ kind: z.enum(['a', 'b']), note: z.string().optional() }) },
  { name: 'nested object and array', schema: z.object({ rounds: z.array(z.object({ id: z.string() })) }) },
  { name: 'visibility annotation', schema: z.object({ title: z.string().meta({ 'x-visibility': 'public' }) }) },
];

// Schemas that must be refused: each would either vanish silently or fail to convert.
export const unrepresentableSchemas: { name: string; schema: z.ZodType }[] = [
  { name: 'top-level .refine()', schema: z.object({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b) },
  { name: 'nested .refine()', schema: z.object({ inner: z.object({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b) }) },
  { name: '.refine() inside an array', schema: z.object({ xs: z.array(z.string().refine((s) => s.length > 2)) }) },
  { name: '.superRefine()', schema: z.object({ s: z.string() }).superRefine(() => {}) },
  { name: 'z.date()', schema: z.object({ at: z.date() }) },
  { name: 'z.bigint()', schema: z.object({ n: z.bigint() }) },
  { name: '.transform()', schema: z.object({ s: z.string().transform((s) => s.length) }) },
];
```

`packages/sdk/src/manifest/define-app.contract.spec.ts`:

```ts
import { z } from 'zod';
import { ContractError } from '../errors/error-codes';
import { CONTRACT_VERSION } from '../contract-version';
import { appManifestSchema } from './manifest.schema';
import { readPropertyVisibility } from './app-settings-visibility';
import { defineApp, toRegisteredSchema } from './define-app';
import { representableSchemas, unrepresentableSchemas } from './define-app.fixtures';

const quizSettings = z.object({
  title: z.string().meta({ 'x-visibility': 'public' }),
  correctAnswers: z.array(z.number()),
});

const defineQuiz = () =>
  defineApp({
    appId: 'quiz',
    manifestVersion: 1,
    appSettings: quizSettings,
    events: {
      'answer.submitted': {
        schema: z.object({ roundId: z.string(), choice: z.number().int() }),
        visibility: 'module-private',
      },
    },
  });

describe('conversion guard', () => {
  it.each(representableSchemas.map((c) => [c.name, c.schema] as const))(
    'converts a legal schema: %s',
    (_name, schema) => {
      expect(() => toRegisteredSchema(schema)).not.toThrow();
    },
  );

  // Design §6: the loss is SILENT, which is the ADR-008 class of defect — the app
  // believes the core enforces a rule the core never received. Reject instead.
  it.each(unrepresentableSchemas.map((c) => [c.name, c.schema] as const))(
    'refuses a schema that would not survive conversion: %s',
    (_name, schema) => {
      expect(() => toRegisteredSchema(schema)).toThrow(ContractError);
      try {
        toRegisteredSchema(schema);
      } catch (err) {
        expect((err as ContractError).code).toBe('SCHEMA_NOT_REPRESENTABLE');
      }
    },
  );

  // This is the fixture that guards the guard (design §6). It rests on a zod
  // internal (_zod.def.checks); a zod upgrade that breaks detection must fail CI
  // loudly rather than quietly open the gate. Do not silence it — fix the detector.
  it('still detects that zod drops .refine() silently', () => {
    const refined = z.object({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b);
    const converted = JSON.stringify(z.toJSONSchema(refined));

    expect(converted).not.toContain('refine');
    expect(() => toRegisteredSchema(refined)).toThrow(ContractError);
  });

  it('keeps the checks that DO convert', () => {
    const json = toRegisteredSchema(z.object({ nick: z.string().min(1) }));
    expect(JSON.stringify(json)).toContain('minLength');
  });
});

describe('defineApp', () => {
  it('produces a manifest that satisfies the manifest contract', () => {
    expect(appManifestSchema.safeParse(defineQuiz()).success).toBe(true);
  });

  it('defaults contractRange to the current major of the contract', () => {
    expect(defineQuiz().contractRange).toBe(`^${CONTRACT_VERSION}`);
  });

  it('keeps an explicit contractRange', () => {
    const manifest = defineApp({
      appId: 'quiz',
      manifestVersion: 2,
      contractRange: '>=1.0.0 <2.0.0',
      appSettings: quizSettings,
      events: {},
    });
    expect(manifest.contractRange).toBe('>=1.0.0 <2.0.0');
  });

  it('registers events under short names and carries their ceiling', () => {
    const manifest = defineQuiz();
    expect(Object.keys(manifest.events)).toEqual(['answer.submitted']);
    expect(manifest.events['answer.submitted'].visibility).toBe('module-private');
  });

  it('snapshots appSettings with visibility annotations intact (ADR-008)', () => {
    const manifest = defineQuiz();
    expect(readPropertyVisibility(manifest.appSettings, 'title')).toBe('public');
    // Never annotated → module-private, and that is what the outcome-deciding data
    // must be (REQ-CORE-008).
    expect(readPropertyVisibility(manifest.appSettings, 'correctAnswers')).toBe('module-private');
  });

  // REQ-CTR-002: what the registry stores must be serializable — no live zod.
  it('produces a JSON-serializable manifest with no live objects in it', () => {
    const manifest = defineQuiz();
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('refuses an app that would take the core namespace', () => {
    expect(() =>
      defineApp({ appId: 'core', manifestVersion: 1, appSettings: quizSettings, events: {} }),
    ).toThrow(ContractError);
  });

  it('refuses an unrepresentable event schema with a typed error', () => {
    expect(() =>
      defineApp({
        appId: 'quiz',
        manifestVersion: 1,
        appSettings: quizSettings,
        events: {
          'answer.submitted': {
            schema: z.object({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b),
            visibility: 'module-private',
          },
        },
      }),
    ).toThrow(ContractError);
  });

  it('refuses a misspelled visibility annotation', () => {
    expect(() =>
      defineApp({
        appId: 'quiz',
        manifestVersion: 1,
        appSettings: z.object({ title: z.string().meta({ 'x-visibility': 'publik' }) }),
        events: {},
      }),
    ).toThrow(ContractError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/manifest/define-app -v`
Expected: FAIL — `Cannot find module './define-app'`.

- [ ] **Step 3: Write the implementation** — `packages/sdk/src/manifest/define-app.ts`

```ts
import { z } from 'zod';
import { CONTRACT_VERSION } from '../contract-version';
import { ContractError } from '../errors/error-codes';
import type { Visibility } from '../visibility/visibility';
import { assertVisibilityAnnotations } from './app-settings-visibility';
import {
  appManifestSchema,
  type AppManifest,
  type JsonSchemaObject,
} from './manifest.schema';

// The authoring surface (design §4.6): an app writes zod — types and DX — while the
// REGISTERED artifact is JSON Schema. That is what makes REQ-RT-004 an invariant
// held by data: the snapshot sits in the core's storage under
// (appId, manifestVersion), so a module cannot break an active room's validation by
// deleting last version's code.
export type AppDefinition = {
  appId: string;
  manifestVersion: number;
  // Defaults to the current major of the contract (REQ-CTR-004).
  contractRange?: string;
  appSettings: z.ZodType;
  // Short names; the core prefixes the namespace itself (design §4.1).
  events: Record<string, { schema: z.ZodType; visibility: Visibility }>;
};

type ZodInternals = { _zod?: { def?: { checks?: unknown[] } } };
type CheckInternals = { _zod?: { def?: { check?: string } } };

// A custom refinement reports check === 'custom'; ordinary checks report their own
// kind ('min_length', 'greater_than', …) and convert fine. Testing for a non-empty
// checks array would reject legal schemas.
const hasCustomCheck = (schema: unknown): boolean =>
  ((schema as ZodInternals)?._zod?.def?.checks ?? []).some(
    (check) => (check as CheckInternals)?._zod?.def?.check === 'custom',
  );

// The conversion guard (design §6).
//
// z.toJSONSchema drops .refine()/.superRefine() SILENTLY while throwing on
// date/bigint/transform. Silent loss is the defect class ADR-008 exists to prevent:
// the app is convinced the core enforces its rule, and the core never received it.
// So a manifest carrying one is refused outright.
//
// This reads a zod internal (_zod.def.checks) on purpose. The cure is the project's
// own principle: the guard is covered by a fixture, so a zod upgrade that breaks
// detection turns CI red instead of quietly opening the gate.
export const toRegisteredSchema = (schema: z.ZodType): JsonSchemaObject => {
  try {
    // `override` is invoked for every subschema, so it walks the tree for us —
    // nested refinements and refinements inside arrays included.
    const json = z.toJSONSchema(schema, {
      override: (ctx) => {
        if (hasCustomCheck(ctx.zodSchema)) {
          throw new ContractError(
            'SCHEMA_NOT_REPRESENTABLE',
            'custom refinement (.refine/.superRefine) cannot be represented in JSON Schema and would be dropped silently',
          );
        }
      },
    });
    return { ...json } as JsonSchemaObject;
  } catch (err) {
    if (err instanceof ContractError) {
      throw err;
    }
    // date / bigint / transform: zod throws by itself — re-wrap as a typed code so
    // nothing raw reaches the caller (REQ-SEC-006).
    throw new ContractError(
      'SCHEMA_NOT_REPRESENTABLE',
      err instanceof Error ? err.message : String(err),
    );
  }
};

// Where zod stops being the artifact and JSON Schema starts. The core validates the
// FORM from this snapshot; semantics that need room state stay with the app
// (design §4.6, REQ-RT-013).
export const defineApp = (definition: AppDefinition): AppManifest => {
  const appSettings = toRegisteredSchema(definition.appSettings);
  assertVisibilityAnnotations(appSettings);

  const events = Object.fromEntries(
    Object.entries(definition.events).map(([shortName, event]) => [
      shortName,
      { schema: toRegisteredSchema(event.schema), visibility: event.visibility },
    ]),
  );

  const manifest = {
    appId: definition.appId,
    manifestVersion: definition.manifestVersion,
    contractRange: definition.contractRange ?? `^${CONTRACT_VERSION}`,
    appSettings,
    events,
  };

  const parsed = appManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new ContractError('MANIFEST_INVALID', parsed.error.message);
  }

  return parsed.data;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/manifest/define-app -v`
Expected: PASS — 23 tests.

- [ ] **Step 5: Export from the package surface** — add to `packages/sdk/src/index.ts`

```ts
export * from './manifest/define-app';
export * from './manifest/define-app.fixtures';
```

The finished `packages/sdk/src/index.ts` in full:

```ts
export * from './contract-version';
export * from './errors/error-codes';
export * from './visibility/visibility';
export * from './visibility/visibility.fixtures';
export * from './events/event-type';
export * from './events/log-event.schema';
export * from './events/log-event.fixtures';
export * from './events/projected-event.schema';
export * from './events/projected-event.fixtures';
export * from './events/core-events';
export * from './manifest/manifest.schema';
export * from './manifest/manifest.fixtures';
export * from './manifest/app-settings-visibility';
export * from './manifest/define-app';
export * from './manifest/define-app.fixtures';
```

- [ ] **Step 6: Run every gate the way CI runs it**

Run: `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build && pnpm run boundary-check && pnpm run guardrails`
Expected: all green. `boundary-check` reports no violations (SDK still a leaf); `guardrails` prints `All guardrails verified alive.`

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/manifest packages/sdk/src/index.ts
git commit -m "feat(sdk): zod authoring surface with fail-closed conversion guard (REQ-CTR-008, ADR-006, ADR-008)"
```

---

## Exit Criteria (verify all before declaring the SDK contract core done)

Each maps to a phase-1 exit criterion from the normative package §5 as amended by v1.3, restricted to what the SDK can hold; the rest belongs to the core-service plans.

- [ ] `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build && pnpm run boundary-check && pnpm run guardrails` — all green (REQ-DEV-001).
- [ ] Every contract surface has valid **and** invalid fixtures, exported from the package (REQ-CTR-005) — Tasks 1, 3, 4, 7, 9.
- [ ] An event whose visibility is more exposed than its type's ceiling is refused — the lattice half of REQ-CTR-009 (Task 1); the commit-time rejection is the core pipeline's plan.
- [ ] A manifest whose schema carries `.refine()` is refused, and the fixture that proves zod still drops it silently is green (design §6) — Task 9.
- [ ] A manifest with an unrepresentable type (`date` / `bigint` / `transform`) is refused (Task 9).
- [ ] An unannotated `appSettings` property reads as `module-private` — fail-safe of ADR-008 (Task 8); its absence from a participant's projection is the projection builder's plan.
- [ ] An incompatible `contractRange` is refused with `CONTRACT_VERSION_INCOMPATIBLE` (Task 6).
- [ ] The outward projection has no `seq` field to expose — REQ-RT-011(a) per amendment v1.3 (Task 4).
- [ ] `CONTRACT_VERSION` equals `packages/sdk/package.json` version (Task 6, REQ-CTR-004).
- [ ] Errors leave as a bare code — no message, no stack (Task 2, REQ-SEC-006).

## What this plan deliberately does NOT build

Recorded so a reviewer does not read absence as an omission.

- **Enforcement points of design §7** — registration flow, appSettings write path and validator caching (REQ-CORE-007), the commit pipeline with its mandatory step order (REQ-RT-007/009/012/014/016), projection building (REQ-CORE-005/008), fail-closed on DB loss (REQ-DEV-008). This plan gives them their schemas, typed errors and pure rules; the services are separate plans, and design §7 is binding on them.
- **Identity / room / membership DTOs** — separate spec (design §1).
- **Rewards contract** — §6.1 of the task list puts it in the SDK contract, but §5 puts Rewards in phase 3 and gate 2 forbids heavy phase-3 investment before the first live event. Resolved in favour of §5, confirmed by the owner on 2026-07-16. ADR-003 gives rewards its own contract attached through a manifest capability, so it is additive by construction.
- **`capabilities` manifest field** — the extension point for the above is fixed in ADR-003's words, not in an empty field (CLAUDE.md §2.3). `appManifestSchema` is strict, so it will be a deliberate change.
- **Replay cursor and per-level numbering** — design §4.4; part (b) of REQ-RT-011 is phase 4 per amendment v1.3.
- **A second version axis per event type** — REQ-RT-004 pins the manifest as a whole (design §4.2).
- **`core.room.created`** — not a REQ-RT-005 transition; a Room-plan question, additive if wanted.

## Self-Review Notes

**Spec coverage.** Design §4.1 → Task 3; §4.2 → Tasks 5, 6; §4.3 → Tasks 1, 4; §4.4 → Task 4 (structural: no cursor exists); §4.5 → Task 1; §4.6 → Task 9; §5 manifest → Tasks 7, 8, 9; §6 guard → Task 9; §8 errors → Task 2; §9 fixtures → Tasks 1, 3, 4, 7, 8, 9; §10 file layout → all, plus the three added files noted above. §7 is intentionally not implemented (see above) — it is recorded as binding on later plans.

**Empirics re-verified, not trusted.** All four zod facts of design §3 were re-run against zod 4.4.3 while writing this plan, and one detail the design does not state was found: `.min(1)` also populates `_zod.def.checks`, so the discriminator must be `check === 'custom'`. A guard written from the design's prose alone would have rejected every schema with a `.min()`.

**Type consistency.** `Visibility` (Task 1) is consumed by Tasks 5, 7, 8, 9. `JsonSchemaObject` (Task 7) is consumed by Tasks 8, 9 — Task 8 imports it as a type only, so no cycle. `ContractError` (Task 2) is consumed by Tasks 3, 6, 8, 9. `eventTypeSchema` (Task 3) is consumed by Tasks 4 and, via edit, by `log-event.schema.ts`. `appIdSchema` (Task 3) is consumed by Tasks 5 and 7. `EventTypeDefinition` (Task 5) and `manifestEventSchema` (Task 7) are deliberately the same shape minus the schema representation — zod live vs JSON Schema snapshot — which is exactly the §4.2 statement that the pipeline differs only in the registry's source.

**Ordering.** Tasks 1→2→3 are foundations; 4 and 5 depend on 3; 6 is independent apart from 2; 7 depends on 1 and 3; 8 on 1, 2, 7; 9 on everything. Executing in order keeps every task's test suite runnable on its own.
