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
