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
