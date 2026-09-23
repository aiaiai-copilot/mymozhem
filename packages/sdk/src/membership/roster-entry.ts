import { z } from 'zod';

// GET /rooms/:roomId/members (дизайн UI-среза, решение №10): ростер — read-контур;
// в лог displayName не пишется (REQ-SEC-009 касается событий). displayName nullable —
// TTL-свип анонимизирует гостя, membership при этом жив. Wire-роли lowercase —
// прецедент JoinRequest ('participant' | 'spectator').
export const rosterRoleSchema = z.enum(['organizer', 'moderator', 'participant', 'spectator']);
export type RosterRole = z.infer<typeof rosterRoleSchema>;

export const rosterEntrySchema = z.strictObject({
  identityId: z.uuid(),
  displayName: z.string().nullable(),
  role: rosterRoleSchema,
});
export type RosterEntry = z.infer<typeof rosterEntrySchema>;

export const rosterResponseSchema = z.strictObject({ members: z.array(rosterEntrySchema) });
export type RosterResponse = z.infer<typeof rosterResponseSchema>;
