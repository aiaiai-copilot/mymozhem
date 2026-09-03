import { z } from 'zod';

// GET /auth/google query (REQ-ID-009): redirect валидируется сервером по allowlist,
// здесь — только форма. strict: лишние ключи не проходят.
export const oauthStartQuerySchema = z.strictObject({
  redirect: z.string().optional(),
});
export type OAuthStartQuery = z.infer<typeof oauthStartQuerySchema>;
