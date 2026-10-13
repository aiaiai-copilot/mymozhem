## Task 3: Event-type namespace and structural owner resolution

**Files:**
- Create: `packages/sdk/src/events/event-type.ts`, `packages/sdk/src/events/event-type.contract.spec.ts`
- Modify: `packages/sdk/src/events/log-event.schema.ts` (use `eventTypeSchema`), `packages/sdk/src/events/log-event.fixtures.ts` (re-namespace types), `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `appIdSchema`, `AppId`, `CORE_NAMESPACE = 'core'`, `shortEventNameSchema`, `eventTypeSchema`, `composeEventType(namespace, shortName): string`, `resolveTypeOwner(type): TypeOwner`, `type TypeOwner = { kind: 'core'; shortName: string } | { kind: 'app'; appId: AppId; shortName: string }`.
- Consumes: `ContractError` (Task 2).

> **Design note (fixture correction):** the phase-0 fixture `log-event.fixtures.ts` uses the event type `room.created`. Under §4.1 that parses as an app named `room` owning the type — it contradicts the ownership rule the same package now exports. It is re-namespaced to `core.room.activated` here. Not cosmetic: a fixture that its own rule would misread is worse than no fixture.

- [ ] **Step 1: Write the failing test** — `packages/sdk/src/events/event-type.contract.spec.ts`

```ts
import {
  CORE_NAMESPACE,
  appIdSchema,
  composeEventType,
  eventTypeSchema,
  resolveTypeOwner,
  shortEventNameSchema,
} from './event-type';
import { ContractError } from '../errors/error-codes';

describe('event type ownership', () => {
  it.each(['core.room.activated', 'quiz.answer_scored', 'quiz.answer.submitted'])(
    'accepts a namespaced type: %s',
    (type) => {
      expect(eventTypeSchema.safeParse(type).success).toBe(true);
    },
  );

  it.each(['nodot', 'core.', '.leading', 'Quiz.Answer', 'quiz..double'])(
    'rejects a malformed type: %s',
    (type) => {
      expect(eventTypeSchema.safeParse(type).success).toBe(false);
    },
  );

  it('resolves the core namespace to the core', () => {
    expect(resolveTypeOwner('core.room.activated')).toEqual({
      kind: 'core',
      shortName: 'room.activated',
    });
  });

  it('resolves any other namespace to the app that owns it', () => {
    expect(resolveTypeOwner('quiz.answer.submitted')).toEqual({
      kind: 'app',
      appId: 'quiz',
      shortName: 'answer.submitted',
    });
  });

  it('rejects an unresolvable type with a typed error', () => {
    expect(() => resolveTypeOwner('nodot')).toThrow(ContractError);
    try {
      resolveTypeOwner('nodot');
    } catch (err) {
      expect((err as ContractError).code).toBe('EVENT_UNKNOWN_TYPE');
    }
  });

  // §4.1: an app declares SHORT names; the core prefixes the namespace itself.
  // Forging a foreign namespace must be inexpressible, not merely forbidden.
  it('gives an app no way to declare into the core namespace', () => {
    expect(shortEventNameSchema.safeParse('room.activated').success).toBe(true);
    expect(composeEventType('quiz', 'room.activated')).toBe('quiz.room.activated');
    expect(resolveTypeOwner(composeEventType('quiz', 'room.activated')).kind).toBe('app');
  });

  it('reserves the core namespace against an app claiming it as its appId', () => {
    expect(appIdSchema.safeParse(CORE_NAMESPACE).success).toBe(false);
    expect(appIdSchema.safeParse('quiz').success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/events/event-type -v`
Expected: FAIL — `Cannot find module './event-type'`.

- [ ] **Step 3: Write the implementation** — `packages/sdk/src/events/event-type.ts`

```ts
import { z } from 'zod';
import { ContractError } from '../errors/error-codes';

// The namespace owned by the core (design §4.1).
export const CORE_NAMESPACE = 'core';

// appId is a slug and, at the same time, the app's event namespace (design §5).
// `core` is refused so that an app cannot obtain the core namespace by naming itself.
export const appIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'appId must be a lowercase slug')
  .refine((id) => id !== CORE_NAMESPACE, { message: 'appId "core" is reserved' });
export type AppId = z.infer<typeof appIdSchema>;

// A short name as declared in a registry. Dots are allowed (`answer.submitted`):
// they cannot forge a namespace, because the owner prefix is prepended
// unconditionally by composeEventType.
export const shortEventNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/, 'short event name must be a dotted lowercase path');

// A fully-qualified event type: `<namespace>.<short name>`.
export const eventTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/, 'event type must be namespaced');

export const composeEventType = (namespace: string, shortName: string): string =>
  `${namespace}.${shortName}`;

export type TypeOwner =
  | { kind: 'core'; shortName: string }
  | { kind: 'app'; appId: AppId; shortName: string };

// Ownership is resolved by parsing the name — no lookup table that could drift out
// of sync with the registry (design §4.1).
export const resolveTypeOwner = (type: string): TypeOwner => {
  if (!eventTypeSchema.safeParse(type).success) {
    throw new ContractError('EVENT_UNKNOWN_TYPE', `event type "${type}" is not namespaced`);
  }

  const separator = type.indexOf('.');
  const namespace = type.slice(0, separator);
  const shortName = type.slice(separator + 1);

  if (namespace === CORE_NAMESPACE) {
    return { kind: 'core', shortName };
  }

  const appId = appIdSchema.safeParse(namespace);
  if (!appId.success) {
    throw new ContractError('EVENT_UNKNOWN_TYPE', `event type "${type}" has no resolvable owner`);
  }

  return { kind: 'app', appId: appId.data, shortName };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/events/event-type -v`
Expected: PASS — 13 tests.

- [ ] **Step 5: Tighten the envelope's type field** — in `packages/sdk/src/events/log-event.schema.ts`, import `eventTypeSchema` and replace the `type` line

```ts
import { z } from 'zod';
import { visibilitySchema } from '../visibility/visibility';
import { eventTypeSchema } from './event-type';
```

and inside `logEventSchema`, replace `type: z.string().min(1),` with:

```ts
  type: eventTypeSchema,
```

- [ ] **Step 6: Re-namespace the phase-0 fixtures** — `packages/sdk/src/events/log-event.fixtures.ts`, change the `type` of both valid fixtures and add an invalid case

```ts
import type { LogEvent } from './log-event.schema';

export const validLogEvents: LogEvent[] = [
  {
    roomId: '11111111-1111-4111-8111-111111111111',
    seq: 0,
    type: 'core.room.activated',
    payload: { appId: 'quiz', manifestVersion: 1 },
    actorId: null,
    visibility: 'public',
    schemaVersion: 1,
  },
  {
    roomId: '11111111-1111-4111-8111-111111111111',
    seq: 1,
    type: 'quiz.answer_scored',
    payload: { correct: true },
    actorId: '22222222-2222-4222-8222-222222222222',
    visibility: 'module-private',
    schemaVersion: 1,
  },
];

export const invalidLogEventCases: { name: string; value: unknown }[] = [
  {
    name: 'unknown visibility level',
    value: { ...validLogEvents[0], visibility: 'secret' },
  },
  {
    name: 'missing seq',
    value: (() => {
      const { seq, ...rest } = validLogEvents[0];
      void seq;
      return rest;
    })(),
  },
  {
    name: 'negative seq',
    value: { ...validLogEvents[0], seq: -1 },
  },
  {
    name: 'non-uuid roomId',
    value: { ...validLogEvents[0], roomId: 'not-a-uuid' },
  },
  {
    name: 'event type without an owning namespace',
    value: { ...validLogEvents[0], type: 'created' },
  },
];
```

- [ ] **Step 7: Run the package and export the surface**

Add to `packages/sdk/src/index.ts` (after the visibility line):

```ts
export * from './events/event-type';
```

Run: `pnpm --filter @mymozhem/sdk test`
Expected: PASS — both `event-type.contract.spec.ts` and the phase-0 `log-event.contract.spec.ts` green, the latter now with 5 invalid cases.

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/events packages/sdk/src/index.ts
git commit -m "feat(sdk): structural event-type ownership by namespace (REQ-CTR-008, ADR-002)"
```

---

