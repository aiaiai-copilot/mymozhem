import { z } from 'zod';

// GET /auth/google/callback query (REQ-ID-009): code+state при успехе, error при
// отказе пользователя — все optional, семантику разбирает OAuthService.
// НЕ strictObject: Google дописывает свои query-параметры в callback-URL
// (scope/authuser/prompt и т.п.) — strict-отказ давал 400 REQUEST_INVALID на штатном
// входе (manual smoke OAuth 2026-09-24). Неизвестные ключи strip'аются.
export const oauthCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;
