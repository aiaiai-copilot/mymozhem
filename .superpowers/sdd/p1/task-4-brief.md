## Task 4: Outward projection envelope without seq

**Files:**
- Create: `packages/sdk/src/events/projected-event.schema.ts`, `packages/sdk/src/events/projected-event.fixtures.ts`, `packages/sdk/src/events/projected-event.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `projectedEventSchema`, `ProjectedEvent`, `validProjectedEvents`, `invalidProjectedEventCases`.
- Consumes: `eventTypeSchema` (Task 3), `LogEvent` (phase 0).

> **Design note (`strictObject`, recorded for review):** the projection is a strict object, so an extra key is **rejected** rather than stripped. Verified on zod 4.4.3: a plain `z.object` silently strips `seq` from `{...logEvent}` and returns a clean projection — the leak is prevented but the bug survives and the next field added to the envelope may not be stripped so kindly. The realistic defect here is a core handler spreading a whole `LogEvent` into the projection; strict makes that a loud failure at the seam. It is also fail-closed in the REQ-DEV-008 sense: refusing to answer beats answering with metadata RT-011(a) forbids.

- [ ] **Step 1: Write the failing test** — `packages/sdk/src/events/projected-event.fixtures.ts`

```ts
import type { LogEvent } from './log-event.schema';
import type { ProjectedEvent } from './projected-event.schema';

export const validProjectedEvents: ProjectedEvent[] = [
  {
    type: 'core.room.activated',
    payload: { appId: 'quiz', manifestVersion: 1 },
    actorId: null,
  },
  {
    type: 'quiz.answer.submitted',
    payload: { roundId: 'r1', choice: 2 },
    actorId: '22222222-2222-4222-8222-222222222222',
  },
];

// The internal envelope a careless handler might hand to a client verbatim.
const internalLogEvent: LogEvent = {
  roomId: '11111111-1111-4111-8111-111111111111',
  seq: 42,
  type: 'quiz.answer.submitted',
  payload: { roundId: 'r1', choice: 2 },
  actorId: '22222222-2222-4222-8222-222222222222',
  visibility: 'public',
  schemaVersion: 1,
};

export const invalidProjectedEventCases: { name: string; value: unknown }[] = [
  {
    name: 'whole log envelope spread outward (leaks seq — REQ-RT-011a)',
    value: internalLogEvent,
  },
  {
    name: 'seq smuggled onto an otherwise clean projection',
    value: { ...validProjectedEvents[0], seq: 0 },
  },
  {
    name: 'visibility label sent outward',
    value: { ...validProjectedEvents[0], visibility: 'public' },
  },
  {
    name: 'replay cursor sent outward (no cursor exists in MVP — design §4.4)',
    value: { ...validProjectedEvents[0], cursor: 'eyJzZXEiOjQyfQ==' },
  },
  {
    name: 'event type without an owning namespace',
    value: { ...validProjectedEvents[0], type: 'activated' },
  },
];
```

`packages/sdk/src/events/projected-event.contract.spec.ts`:

```ts
import { projectedEventSchema } from './projected-event.schema';
import {
  invalidProjectedEventCases,
  validProjectedEvents,
} from './projected-event.fixtures';

describe('projectedEvent contract', () => {
  it.each(validProjectedEvents.map((e, i) => [i, e] as const))(
    'accepts valid fixture #%i',
    (_i, event) => {
      expect(projectedEventSchema.safeParse(event).success).toBe(true);
    },
  );

  it.each(invalidProjectedEventCases.map((c) => [c.name, c.value] as const))(
    'rejects invalid fixture: %s',
    (_name, value) => {
      expect(projectedEventSchema.safeParse(value).success).toBe(false);
    },
  );

  // REQ-RT-011(a) per amendment v1.3: the global seq is never exposed to a
  // participant. It holds structurally — the field is not in the schema at all.
  it('has no seq, visibility or cursor field to expose', () => {
    const keys = Object.keys(projectedEventSchema.shape);
    expect(keys.sort()).toEqual(['actorId', 'payload', 'type']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk exec jest src/events/projected-event -v`
Expected: FAIL — `Cannot find module './projected-event.schema'`.

- [ ] **Step 3: Write the implementation** — `packages/sdk/src/events/projected-event.schema.ts`

```ts
import { z } from 'zod';
import { eventTypeSchema } from './event-type';

// What actually leaves the core towards a client (design §4.3).
//
// No seq, no visibility, no cursor: REQ-RT-011(a) — «глобальный seq не
// экспонируется участнику» — holds structurally, because none of those values
// exist in this shape to be exposed. The MVP has no replay cursor at all
// (design §4.4): replay returns the full visible projection.
//
// strictObject, not object: an extra key is a core bug, and a loud rejection beats
// a silent strip that leaves the bug alive.
export const projectedEventSchema = z.strictObject({
  type: eventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  actorId: z.uuid().nullable(),
});
export type ProjectedEvent = z.infer<typeof projectedEventSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk exec jest src/events/projected-event -v`
Expected: PASS — 8 tests.

- [ ] **Step 5: Export from the package surface** — add to `packages/sdk/src/index.ts`

```ts
export * from './events/projected-event.schema';
export * from './events/projected-event.fixtures';
```

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/events packages/sdk/src/index.ts
git commit -m "feat(sdk): outward projection envelope carries no seq (REQ-RT-001, REQ-RT-011)"
```

---

