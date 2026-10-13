## Task 7: Manifest schema

**Files:**
- Create: `packages/sdk/src/manifest/manifest.schema.ts`, `packages/sdk/src/manifest/manifest.fixtures.ts`, `packages/sdk/src/manifest/manifest.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `jsonSchemaObjectSchema`, `JsonSchemaObject`, `contractRangeSchema`, `manifestEventSchema`, `appManifestSchema`, `AppManifest`, `validManifests`, `invalidManifestCases`.
- Consumes: `visibilitySchema` (Task 1), `appIdSchema`, `shortEventNameSchema` (Task 3).

- [ ] **Step 1: Write the failing test** — `packages/sdk/src/manifest/manifest.fixtures.ts`

```ts
import type { AppManifest } from './manifest.schema';

export const validManifests: AppManifest[] = [
  {
    appId: 'quiz',
    manifestVersion: 1,
    contractRange: '^1.0.0',
    appSettings: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        title: { type: 'string', 'x-visibility': 'public' },
        correctAnswers: { type: 'array', items: { type: 'number' } },
      },
      required: ['title', 'correctAnswers'],
      additionalProperties: false,
    },
    events: {
      'answer.submitted': {
        schema: {
          type: 'object',
          properties: { roundId: { type: 'string' }, choice: { type: 'number' } },
          required: ['roundId', 'choice'],
          additionalProperties: false,
        },
        visibility: 'module-private',
      },
      'round.opened': {
        schema: { type: 'object', properties: {}, additionalProperties: false },
        visibility: 'public',
      },
    },
  },
];

export const invalidManifestCases: { name: string; value: unknown }[] = [
  {
    name: 'appId is not a slug',
    value: { ...validManifests[0], appId: 'Quiz App' },
  },
  {
    name: 'appId claims the reserved core namespace',
    value: { ...validManifests[0], appId: 'core' },
  },
  {
    name: 'manifestVersion is not a positive integer',
    value: { ...validManifests[0], manifestVersion: 0 },
  },
  {
    name: 'contractRange is not a semver range',
    value: { ...validManifests[0], contractRange: 'whatever' },
  },
  {
    name: 'event short name would forge a namespace',
    value: {
      ...validManifests[0],
      events: { 'Bad.Key!': { schema: { type: 'object' }, visibility: 'public' } },
    },
  },
  {
    name: 'event declares an unknown visibility ceiling',
    value: {
      ...validManifests[0],
      events: { 'answer.submitted': { schema: { type: 'object' }, visibility: 'secret' } },
    },
  },
  {
    name: 'event definition misses its visibility ceiling (REQ-CTR-009 makes it mandatory)',
    value: {
      ...validManifests[0],
      events: { 'answer.submitted': { schema: { type: 'object' } } },
    },
  },
  {
    name: 'manifest carries a capabilities field (rewards is phase 3 — design §5)',
    value: { ...validManifests[0], capabilities: ['rewards'] },
  },
];
```

`packages/sdk/src/manifest/manifest.contract.spec.ts`:

```ts
import { appManifestSchema, contractRangeSchema } from './manifest.schema';
import { invalidManifestCases, validManifests } from './manifest.fixtures';

describe('app manifest contract', () => {
  it.each(validManifests.map((m, i) => [i, m] as const))(
    'accepts valid fixture #%i',
    (_i, manifest) => {
      expect(appManifestSchema.safeParse(manifest).success).toBe(true);
    },
  );

  it.each(invalidManifestCases.map((c) => [c.name, c.value] as const))(
    'rejects invalid fixture: %s',
    (_name, value) => {
      expect(appManifestSchema.safeParse(value).success).toBe(false);
    },
  );

  it('accepts any well-formed semver range and refuses nonsense', () => {
    expect(contractRangeSchema.safeParse('^1.0.0').success).toBe(true);
    expect(contractRangeSchema.safeParse('>=1.0.0 <2.0.0').success).toBe(true);
    expect(contractRangeSchema.safeParse('garbage!!').success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/manifest/manifest -v`
Expected: FAIL — `Cannot find module './manifest.schema'`.

- [ ] **Step 3: Write the implementation** — `packages/sdk/src/manifest/manifest.schema.ts`

```ts
import { z } from 'zod';
import { validRange } from 'semver';
import { visibilitySchema } from '../visibility/visibility';
import { appIdSchema, shortEventNameSchema } from '../events/event-type';

// A serialized JSON Schema as carried inside the manifest. ADR-006: the settings and
// event-type schemas of a given app "переносятся как сериализуемая JSON Schema
// внутри манифеста". Deliberately structural rather than a full JSON Schema
// meta-schema: authoring correctness is guaranteed upstream by defineApp, which is
// the only sanctioned way to produce one.
export const jsonSchemaObjectSchema = z.record(z.string(), z.unknown());
export type JsonSchemaObject = z.infer<typeof jsonSchemaObjectSchema>;

// NB for a future reader: .refine() is legal HERE. The guard in define-app.ts bans
// refinements only in APP-AUTHORED schemas, because those get converted to JSON
// Schema and the refinement would vanish silently. This schema is core-owned zod and
// is never converted — there is nothing to lose. Do not "fix" this.
export const contractRangeSchema = z
  .string()
  .refine((range) => validRange(range) !== null, { message: 'not a valid semver range' });

// Per-type exposure ceiling is mandatory (REQ-CTR-009, ADR-008 §2).
export const manifestEventSchema = z.strictObject({
  schema: jsonSchemaObjectSchema,
  visibility: visibilitySchema,
});

// The manifest (design §5). strictObject: an unknown field is refused rather than
// ignored — notably `capabilities`, which ADR-003 will introduce for rewards in
// phase 3 and which must not appear as empty scaffolding now (CLAUDE.md §2.3).
export const appManifestSchema = z.strictObject({
  appId: appIdSchema,
  manifestVersion: z.number().int().positive(),
  contractRange: contractRangeSchema,
  appSettings: jsonSchemaObjectSchema,
  events: z.record(shortEventNameSchema, manifestEventSchema),
});
export type AppManifest = z.infer<typeof appManifestSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/manifest/manifest -v`
Expected: PASS — 12 tests.

- [ ] **Step 5: Export from the package surface** — add to `packages/sdk/src/index.ts`

```ts
export * from './manifest/manifest.schema';
export * from './manifest/manifest.fixtures';
```

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/manifest packages/sdk/src/index.ts
git commit -m "feat(sdk): app manifest schema with per-type visibility ceiling (REQ-CTR-004, REQ-CTR-009, ADR-006)"
```

---

