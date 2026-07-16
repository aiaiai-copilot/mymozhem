import { z } from 'zod';

// Visibility levels of room state, log events and appSettings (REQ-CORE-005).
export const VISIBILITY_LEVELS = ['public', 'organizer', 'module-private'] as const;
export const visibilitySchema = z.enum(VISIBILITY_LEVELS);
export type Visibility = z.infer<typeof visibilitySchema>;

// Append-only log event envelope (form of REQ-RT-001). seq is server-assigned;
// actorId is null only for system/lifecycle events.
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
