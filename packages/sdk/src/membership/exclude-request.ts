import { z } from 'zod';

// POST /rooms/:roomId/members/:identityId/exclude (REQ-ID-006). strict: лишние ключи
// не проходят границу. reason — опциональное основание (задел под аудит REQ-ID-018,
// ф.4: там оно станет обязательным для MODERATOR).
export const excludeRequestSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500).optional(),
});
export type ExcludeRequest = z.infer<typeof excludeRequestSchema>;
