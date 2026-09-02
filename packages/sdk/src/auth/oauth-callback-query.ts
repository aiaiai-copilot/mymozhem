import { z } from 'zod';

// GET /auth/google/callback query (REQ-ID-009): code+state при успехе, error при
// отказе пользователя — все optional, семантику разбирает OAuthService.
export const oauthCallbackQuerySchema = z.strictObject({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;
