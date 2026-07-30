import { z } from 'zod';

// Ответ join/refresh (REQ-ID-016). Refresh никогда не ездит в теле — он httpOnly-cookie
// (REQ-ID-008), поэтому его здесь нет и быть не может.
export const tokenResponseSchema = z.strictObject({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;
