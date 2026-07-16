import { z } from 'zod';
import { visibilitySchema } from '../visibility/visibility';

// Append-only log event envelope (form of REQ-RT-001). seq is server-assigned;
// actorId is null only for system/lifecycle events.
// Internal to the core↔module contract: it carries seq and MUST NOT be sent to a
// client — the outward form is projectedEventSchema (design §4.3, REQ-RT-011a).
export const logEventSchema = z.object({
  roomId: z.uuid(),
  seq: z.number().int().nonnegative(),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  actorId: z.uuid().nullable(),
  visibility: visibilitySchema,
  schemaVersion: z.number().int().positive(),
});
export type LogEvent = z.infer<typeof logEventSchema>;
