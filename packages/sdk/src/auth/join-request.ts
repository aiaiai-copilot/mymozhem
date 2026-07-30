import { z } from 'zod';
import { displayNameSchema } from '../identity/display-name';

// POST /rooms/join request body (REQ-ID-003). strict: лишние ключи не проходят границу.
export const joinRequestSchema = z.strictObject({
  code: z.string().trim().min(1),
  displayName: displayNameSchema,
});
export type JoinRequest = z.infer<typeof joinRequestSchema>;
