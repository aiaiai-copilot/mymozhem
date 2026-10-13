### Task 2: SDK — код `ACTOR_NOT_MEMBER`, wire-схемы realtime, версия 1.2.0

**Files:**
- Modify: `packages/sdk/src/errors/error-codes.ts`
- Create: `packages/sdk/src/realtime/realtime-messages.ts`
- Create: `packages/sdk/src/realtime/realtime-messages.fixtures.ts`
- Create: `packages/sdk/src/realtime/realtime-messages.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/src/contract-version.ts:7` (`'1.1.0'` → `'1.2.0'`)
- Modify: `packages/sdk/package.json` (`"version": "1.1.0"` → `"1.2.0"`)

**Interfaces:**
- Consumes: существующие `eventTypeSchema`, `projectedEventSchema`, `visibilitySchema`, `contractErrorPayloadSchema`.
- Produces (нужны Task 3, 4, 7, 8): `ACTOR_NOT_MEMBER` в `CONTRACT_ERROR_CODES`; `REALTIME_MESSAGES = { SUBSCRIBE: 'subscribe', PUBLISH: 'publish', EVENT: 'event' } as const`; `subscribeRequestSchema`/`SubscribeRequest`; `roomSnapshotSchema`/`RoomSnapshot`; `subscribeOkAckSchema`/`SubscribeOkAck`; `publishRequestSchema`/`PublishRequest`; `publishOkAckSchema`/`PublishOkAck`; `CONTRACT_VERSION = '1.2.0'`.

- [ ] **Step 1: Failing contract tests — конверты, фикстуры, новый код**

`packages/sdk/src/realtime/realtime-messages.fixtures.ts`:

```ts
import type { PublishRequest, RoomSnapshot, SubscribeRequest } from './realtime-messages';

export const validSubscribeRequest: SubscribeRequest = {
  roomId: '11111111-1111-4111-8111-111111111111',
};

export const validPublishRequests: PublishRequest[] = [
  { type: 'quiz.answer.submitted', payload: { roundId: 'r1', choice: 2 } },
  {
    type: 'quiz.answer.submitted',
    payload: { roundId: 'r1', choice: 2 },
    visibility: 'organizer',
  },
];

export const validSnapshot: RoomSnapshot = {
  events: [
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
  ],
  appSettings: { roundsCount: 5 },
};

export const invalidSubscribeRequestCases: { name: string; value: unknown }[] = [
  { name: 'extra key (strictObject)', value: { ...validSubscribeRequest, since: 'x' } },
  { name: 'roomId not a uuid', value: { roomId: 'room-1' } },
];

export const invalidPublishRequestCases: { name: string; value: unknown }[] = [
  {
    name: 'type without namespace',
    value: { type: 'activated', payload: {} },
  },
  {
    name: 'visibility outside the enum',
    value: { type: 'quiz.answer.submitted', payload: {}, visibility: 'friends-only' },
  },
  {
    name: 'extra key (strictObject)',
    value: { type: 'quiz.answer.submitted', payload: {}, actorId: 'spoof' },
  },
];

export const invalidSnapshotCases: { name: string; value: unknown }[] = [
  {
    name: 'event carrying seq outward (REQ-RT-011a)',
    value: {
      ...validSnapshot,
      events: [{ ...validSnapshot.events[0], seq: 7 }],
    },
  },
  {
    name: 'replay cursor field (no cursor exists in MVP)',
    value: { ...validSnapshot, cursor: 'eyJzZXEiOjQyfQ==' },
  },
];
```

`packages/sdk/src/realtime/realtime-messages.contract.spec.ts`:

```ts
import { contractErrorCodeSchema } from '../errors/error-codes';
import {
  publishOkAckSchema,
  publishRequestSchema,
  roomSnapshotSchema,
  subscribeOkAckSchema,
  subscribeRequestSchema,
} from './realtime-messages';
import {
  invalidPublishRequestCases,
  invalidSnapshotCases,
  invalidSubscribeRequestCases,
  validPublishRequests,
  validSnapshot,
  validSubscribeRequest,
} from './realtime-messages.fixtures';

describe('realtime messages contract', () => {
  it('accepts the valid subscribe request', () => {
    expect(subscribeRequestSchema.safeParse(validSubscribeRequest).success).toBe(true);
  });

  it.each(invalidSubscribeRequestCases.map((c) => [c.name, c.value] as const))(
    'rejects subscribe request: %s',
    (_name, value) => {
      expect(subscribeRequestSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each(validPublishRequests.map((r, i) => [i, r] as const))(
    'accepts valid publish request #%i',
    (_i, request) => {
      expect(publishRequestSchema.safeParse(request).success).toBe(true);
    },
  );

  it.each(invalidPublishRequestCases.map((c) => [c.name, c.value] as const))(
    'rejects publish request: %s',
    (_name, value) => {
      expect(publishRequestSchema.safeParse(value).success).toBe(false);
    },
  );

  it('accepts the valid snapshot and the ok acks', () => {
    expect(roomSnapshotSchema.safeParse(validSnapshot).success).toBe(true);
    expect(subscribeOkAckSchema.safeParse({ ok: true, snapshot: validSnapshot }).success).toBe(true);
    expect(publishOkAckSchema.safeParse({ ok: true }).success).toBe(true);
  });

  it.each(invalidSnapshotCases.map((c) => [c.name, c.value] as const))(
    'rejects snapshot: %s',
    (_name, value) => {
      expect(roomSnapshotSchema.safeParse(value).success).toBe(false);
    },
  );

  it('ACTOR_NOT_MEMBER is a contract error code (design §0.5)', () => {
    expect(contractErrorCodeSchema.safeParse('ACTOR_NOT_MEMBER').success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk test realtime-messages`
Expected: FAIL — модуля `./realtime-messages` не существует (проверить >0 тестов матчатся).

- [ ] **Step 3: Implementation**

`packages/sdk/src/realtime/realtime-messages.ts`:

```ts
import { z } from 'zod';
import { eventTypeSchema } from '../events/event-type';
import { projectedEventSchema } from '../events/projected-event.schema';
import { visibilitySchema } from '../visibility/visibility';

// Socket.io message names of the realtime contract (REQ-RT-006, design §3): one
// source for the core gateway and any client.
export const REALTIME_MESSAGES = {
  SUBSCRIBE: 'subscribe',
  PUBLISH: 'publish',
  EVENT: 'event',
} as const;

export const subscribeRequestSchema = z.strictObject({
  roomId: z.uuid(),
});
export type SubscribeRequest = z.infer<typeof subscribeRequestSchema>;

// Full visible projection, no cursor (MVP, design §3): replay returns everything
// the requester's level may see. Room status is learned from lifecycle events in
// the same stream (REQ-RT-010) — deliberately no status field. strictObject: an
// extra key (seq, cursor) is a core bug, and loud rejection beats silent strip.
export const roomSnapshotSchema = z.strictObject({
  events: z.array(projectedEventSchema),
  appSettings: z.record(z.string(), z.unknown()),
});
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const subscribeOkAckSchema = z.strictObject({
  ok: z.literal(true),
  snapshot: roomSnapshotSchema,
});
export type SubscribeOkAck = z.infer<typeof subscribeOkAckSchema>;

// visibility is optional: the default is the type's declared ceiling (fail-safe,
// design §0.6); a weaker-than-declared value is rejected at commit (REQ-CTR-009).
// Error acks reuse contractErrorPayloadSchema ({code}) — REQ-SEC-006.
export const publishRequestSchema = z.strictObject({
  type: eventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  visibility: visibilitySchema.optional(),
});
export type PublishRequest = z.infer<typeof publishRequestSchema>;

// The ack carries no seq and no event body: the publisher sees its own event via
// the same fan-out as every subscriber (design §5).
export const publishOkAckSchema = z.strictObject({
  ok: z.literal(true),
});
export type PublishOkAck = z.infer<typeof publishOkAckSchema>;
```

В `packages/sdk/src/errors/error-codes.ts` добавить `'ACTOR_NOT_MEMBER'` в `CONTRACT_ERROR_CODES` — строкой после `'ROOM_SETTINGS_FROZEN',` (до комментария про transport-facing коды).

В `packages/sdk/src/index.ts` добавить после строки `export * from './auth/token-response';`:

```ts
export * from './realtime/realtime-messages';
```

В `packages/sdk/src/contract-version.ts`: `CONTRACT_VERSION = '1.2.0'` (комментарий выше оставить — он про механизм). В `packages/sdk/package.json`: `"version": "1.2.0"`. Аддитивное расширение → minor (REQ-CTR-004); контрактный тест держит package.json и CONTRACT_VERSION равными.

- [ ] **Step 4: Run tests + build**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: PASS (включая существующий contract-version spec на паритет версий).
Run: `pnpm --filter @mymozhem/sdk build`
Expected: успех — dist обновлён (core резолвит SDK из dist).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): realtime wire-конверты + код ACTOR_NOT_MEMBER, контракт 1.2.0 (REQ-CTR-004/005, REQ-RT-006/009)"
```

---

