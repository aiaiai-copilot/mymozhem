import { z } from 'zod';
import { displayNameSchema } from '../identity/display-name';

// POST /rooms/join request body (REQ-ID-003). strict: лишние ключи не проходят границу.
// role (фаза 2, REQ-ID-011): самоназначение зрителем при входе. Только два значения —
// ORGANIZER/MODERATOR через флаг не получить структурно. Отсутствие = participant.
export const joinRequestSchema = z.strictObject({
  code: z.string().trim().min(1),
  displayName: displayNameSchema,
  role: z.enum(['participant', 'spectator']).optional(),
});
export type JoinRequest = z.infer<typeof joinRequestSchema>;
