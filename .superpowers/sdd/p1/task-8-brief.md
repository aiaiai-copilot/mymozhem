## Task 8: Per-property appSettings visibility, fail-safe

**Files:**
- Create: `packages/sdk/src/manifest/app-settings-visibility.ts`, `packages/sdk/src/manifest/app-settings-visibility.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `VISIBILITY_ANNOTATION = 'x-visibility'`, `readPropertyVisibility(appSettings: JsonSchemaObject, property: string): Visibility`, `appSettingsVisibilityMap(appSettings: JsonSchemaObject): Record<string, Visibility>`, `assertVisibilityAnnotations(appSettings: JsonSchemaObject): void`.
- Consumes: `Visibility`, `visibilitySchema`, `DEFAULT_VISIBILITY` (Task 1), `JsonSchemaObject` (Task 7), `ContractError` (Task 2).

> **Design note (why both a fail-safe read and a loud assert):** REQ-CORE-008 makes an *absent* annotation `module-private`. A *misspelled* annotation (`publik`) is a different case: the read stays fail-safe, but silence there would hand an author a setting they believe is public and the core has hidden. `assertVisibilityAnnotations` makes that a `MANIFEST_INVALID` at registration, which is ADR-008's own principle — mislabels are caught at registration, not at projection.

- [ ] **Step 1: Write the failing test** — `packages/sdk/src/manifest/app-settings-visibility.contract.spec.ts`

```ts
import { ContractError } from '../errors/error-codes';
import type { JsonSchemaObject } from './manifest.schema';
import {
  VISIBILITY_ANNOTATION,
  appSettingsVisibilityMap,
  assertVisibilityAnnotations,
  readPropertyVisibility,
} from './app-settings-visibility';

const appSettings: JsonSchemaObject = {
  type: 'object',
  properties: {
    title: { type: 'string', 'x-visibility': 'public' },
    scoreboardMode: { type: 'string', 'x-visibility': 'organizer' },
    correctAnswers: { type: 'array', 'x-visibility': 'module-private' },
    hiddenWeights: { type: 'array' },
  },
};

describe('appSettings per-property visibility', () => {
  it('uses the annotation ADR-008 mandates', () => {
    expect(VISIBILITY_ANNOTATION).toBe('x-visibility');
  });

  it.each([
    ['title', 'public'],
    ['scoreboardMode', 'organizer'],
    ['correctAnswers', 'module-private'],
  ])('reads the declared level of %s', (property, expected) => {
    expect(readPropertyVisibility(appSettings, property)).toBe(expected);
  });

  // REQ-CORE-008 / ADR-008: absence of an annotation means module-private.
  // Forgetting to annotate must close, never open.
  it('treats an unannotated property as module-private', () => {
    expect(readPropertyVisibility(appSettings, 'hiddenWeights')).toBe('module-private');
  });

  it('treats an unknown property as module-private', () => {
    expect(readPropertyVisibility(appSettings, 'nope')).toBe('module-private');
  });

  it.each([
    ['no properties block', { type: 'object' }],
    ['properties is not an object', { type: 'object', properties: 'nonsense' }],
    ['property is not an object', { type: 'object', properties: { a: 'nonsense' } }],
  ])('fails safe when the schema is shaped unexpectedly: %s', (_name, schema) => {
    expect(readPropertyVisibility(schema as JsonSchemaObject, 'a')).toBe('module-private');
  });

  it('maps every property, defaulting the unannotated ones', () => {
    expect(appSettingsVisibilityMap(appSettings)).toEqual({
      title: 'public',
      scoreboardMode: 'organizer',
      correctAnswers: 'module-private',
      hiddenWeights: 'module-private',
    });
  });

  it('accepts annotations that are absent or valid', () => {
    expect(() => assertVisibilityAnnotations(appSettings)).not.toThrow();
  });

  it('rejects a misspelled annotation instead of silently hiding the property', () => {
    const typo: JsonSchemaObject = {
      type: 'object',
      properties: { title: { type: 'string', 'x-visibility': 'publik' } },
    };
    expect(() => assertVisibilityAnnotations(typo)).toThrow(ContractError);
    try {
      assertVisibilityAnnotations(typo);
    } catch (err) {
      expect((err as ContractError).code).toBe('MANIFEST_INVALID');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/manifest/app-settings-visibility -v`
Expected: FAIL — `Cannot find module './app-settings-visibility'`.

- [ ] **Step 3: Write the implementation** — `packages/sdk/src/manifest/app-settings-visibility.ts`

```ts
import { ContractError } from '../errors/error-codes';
import {
  DEFAULT_VISIBILITY,
  visibilitySchema,
  type Visibility,
} from '../visibility/visibility';
import type { JsonSchemaObject } from './manifest.schema';

// The per-property annotation of ADR-008 §1. It survives zod → JSON Schema
// conversion via .meta({ 'x-visibility': ... }) — verified on zod 4.4.3.
export const VISIBILITY_ANNOTATION = 'x-visibility';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const propertiesOf = (appSettings: JsonSchemaObject): Record<string, unknown> =>
  asRecord(appSettings['properties']) ?? {};

// REQ-CORE-008: «отсутствие аннотации трактуется как module-private (fail-safe)».
// Every unreadable shape resolves the same way — the most protected level. To expose
// a property an author must say so explicitly; forgetting closes, never opens.
export const readPropertyVisibility = (
  appSettings: JsonSchemaObject,
  property: string,
): Visibility => {
  const definition = asRecord(propertiesOf(appSettings)[property]);
  if (definition === null) {
    return DEFAULT_VISIBILITY;
  }

  const parsed = visibilitySchema.safeParse(definition[VISIBILITY_ANNOTATION]);
  return parsed.success ? parsed.data : DEFAULT_VISIBILITY;
};

// The whole map, for the core's projection builder (a later plan): it projects
// appSettings by the requester's level exactly as it projects state and events
// (REQ-CORE-005), instead of filtering fields by hand — which the norm forbids.
export const appSettingsVisibilityMap = (
  appSettings: JsonSchemaObject,
): Record<string, Visibility> =>
  Object.fromEntries(
    Object.keys(propertiesOf(appSettings)).map((property) => [
      property,
      readPropertyVisibility(appSettings, property),
    ]),
  );

// A present-but-unknown annotation is an authoring mistake, not a visibility choice.
// Reading it fails safe, but staying silent would leave the author believing a
// property is public while the core hides it. ADR-008 catches mislabels at
// registration; this is that principle applied to the settings channel.
export const assertVisibilityAnnotations = (appSettings: JsonSchemaObject): void => {
  for (const [property, rawDefinition] of Object.entries(propertiesOf(appSettings))) {
    const definition = asRecord(rawDefinition);
    if (definition === null) {
      continue;
    }

    const annotation = definition[VISIBILITY_ANNOTATION];
    if (annotation === undefined) {
      continue;
    }

    if (!visibilitySchema.safeParse(annotation).success) {
      throw new ContractError(
        'MANIFEST_INVALID',
        `appSettings property "${property}" declares an unknown ${VISIBILITY_ANNOTATION}: ${JSON.stringify(annotation)}`,
      );
    }
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/manifest/app-settings-visibility -v`
Expected: PASS — 12 tests.

- [ ] **Step 5: Export from the package surface** — add to `packages/sdk/src/index.ts`

```ts
export * from './manifest/app-settings-visibility';
```

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/manifest packages/sdk/src/index.ts
git commit -m "feat(sdk): fail-safe per-property appSettings visibility (REQ-CORE-008, ADR-008)"
```

---

