## Task 5: Core-owned event registry with lifecycle events

**Files:**
- Create: `packages/sdk/src/events/core-events.ts`, `packages/sdk/src/events/core-events.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `type EventTypeDefinition = { schema: z.ZodType; visibility: Visibility; version: number }`, `CORE_EVENTS`, `CoreEventName`, `coreEventType(name: CoreEventName): string`, `isCoreEventName(name: string): name is CoreEventName`.
- Consumes: `Visibility` (Task 1), `appIdSchema`, `CORE_NAMESPACE`, `composeEventType` (Task 3).

> **Design note (scope of the lifecycle set, recorded for review):** the event set is derived from REQ-RT-005 — the state machine is `DRAFT → ACTIVE → COMPLETED`, `DRAFT → CANCELLED`, `ACTIVE → CANCELLED`, so the transitions are exactly *activated / completed / cancelled*, each `public` per REQ-RT-010. There is deliberately **no** `core.room.created`: creation puts a room in DRAFT and is not a transition, so REQ-RT-010 does not mandate it. Whether the log needs a genesis event is a Room-domain question for the Room plan, and a new registry entry is additive. Payloads are kept minimal for the same reason; `room.activated` carries the pin `(appId, manifestVersion)` because that is precisely what ACTIVE freezes (REQ-RT-004) and it keeps the log self-describing without a join to the room (design §4.2, relevant to REQ-RT-008 archival).

- [ ] **Step 1: Write the failing test** — `packages/sdk/src/events/core-events.contract.spec.ts`

```ts
import { CORE_EVENTS, coreEventType, isCoreEventName } from './core-events';
import { resolveTypeOwner } from './event-type';
import { isWithinCeiling } from '../visibility/visibility';

describe('core event registry', () => {
  it('registers exactly the lifecycle transitions of REQ-RT-005', () => {
    expect(Object.keys(CORE_EVENTS).sort()).toEqual([
      'room.activated',
      'room.cancelled',
      'room.completed',
    ]);
  });

  // REQ-RT-010: lifecycle transitions are emitted as public events.
  it.each(Object.keys(CORE_EVENTS))('declares %s public (REQ-RT-010)', (name) => {
    expect(CORE_EVENTS[name as keyof typeof CORE_EVENTS].visibility).toBe('public');
  });

  it('composes full types inside the core namespace, owned by the core', () => {
    expect(coreEventType('room.activated')).toBe('core.room.activated');
    expect(resolveTypeOwner(coreEventType('room.activated'))).toEqual({
      kind: 'core',
      shortName: 'room.activated',
    });
  });

  it('recognises its own short names and nothing else', () => {
    expect(isCoreEventName('room.activated')).toBe(true);
    expect(isCoreEventName('answer.submitted')).toBe(false);
  });

  // REQ-RT-004: ACTIVE freezes the pin, so the activation event carries it.
  it('validates the activation payload as the pin (appId, manifestVersion)', () => {
    const schema = CORE_EVENTS['room.activated'].schema;
    expect(schema.safeParse({ appId: 'quiz', manifestVersion: 1 }).success).toBe(true);
    expect(schema.safeParse({ appId: 'quiz' }).success).toBe(false);
    expect(schema.safeParse({ appId: 'core', manifestVersion: 1 }).success).toBe(false);
    expect(schema.safeParse({ appId: 'quiz', manifestVersion: 0 }).success).toBe(false);
  });

  it('rejects payload on the terminal transitions', () => {
    expect(CORE_EVENTS['room.completed'].schema.safeParse({}).success).toBe(true);
    expect(CORE_EVENTS['room.completed'].schema.safeParse({ reason: 'x' }).success).toBe(false);
  });

  it('declares a positive schemaVersion for every type', () => {
    for (const def of Object.values(CORE_EVENTS)) {
      expect(def.version).toBeGreaterThan(0);
    }
  });

  // The registry's ceiling is what REQ-CTR-009 enforces at commit time; a public
  // ceiling admits any level, which is what a lifecycle event needs.
  it('admits its own declared level under its own ceiling', () => {
    for (const def of Object.values(CORE_EVENTS)) {
      expect(isWithinCeiling(def.visibility, def.visibility)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/events/core-events -v`
Expected: FAIL — `Cannot find module './core-events'`.

- [ ] **Step 3: Write the implementation** — `packages/sdk/src/events/core-events.ts`

```ts
import { z } from 'zod';
import type { Visibility } from '../visibility/visibility';
import { CORE_NAMESPACE, appIdSchema, composeEventType } from './event-type';

// Shape shared by the core registry and the app registry in a manifest, so that the
// commit pipeline differs only in WHERE the registry comes from, not in its logic
// (design §4.2). `visibility` is the exposure ceiling of the type (REQ-CTR-009);
// `version` is what the core stamps as the event's schemaVersion.
export type EventTypeDefinition = {
  readonly schema: z.ZodType;
  readonly visibility: Visibility;
  readonly version: number;
};

// Core-owned event types. Static zod, with no conversion and no snapshot: the core
// is versioned by the contract rather than by a manifest, and these schemas never
// cross the boundary (design §4.2).
//
// The set is the lifecycle transitions of REQ-RT-005 (DRAFT → ACTIVE → COMPLETED,
// DRAFT → CANCELLED, ACTIVE → CANCELLED), emitted as public events per REQ-RT-010.
export const CORE_EVENTS = {
  'room.activated': {
    // ACTIVE freezes appSettings and the pair (appId, manifestVersion) — REQ-RT-004.
    // Carrying the pin keeps the log self-describing without a join to the room.
    schema: z.strictObject({
      appId: appIdSchema,
      manifestVersion: z.number().int().positive(),
    }),
    visibility: 'public',
    version: 1,
  },
  'room.completed': {
    schema: z.strictObject({}),
    visibility: 'public',
    version: 1,
  },
  'room.cancelled': {
    schema: z.strictObject({}),
    visibility: 'public',
    version: 1,
  },
} as const satisfies Record<string, EventTypeDefinition>;

export type CoreEventName = keyof typeof CORE_EVENTS;

export const coreEventType = (name: CoreEventName): string =>
  composeEventType(CORE_NAMESPACE, name);

export const isCoreEventName = (name: string): name is CoreEventName =>
  Object.prototype.hasOwnProperty.call(CORE_EVENTS, name);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/events/core-events -v`
Expected: PASS — 11 tests.

- [ ] **Step 5: Export from the package surface** — add to `packages/sdk/src/index.ts`

```ts
export * from './events/core-events';
```

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/events packages/sdk/src/index.ts
git commit -m "feat(sdk): core event registry with public lifecycle events (REQ-RT-010, REQ-RT-005)"
```

---

