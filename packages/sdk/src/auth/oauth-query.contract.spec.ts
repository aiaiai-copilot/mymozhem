import { oauthStartQuerySchema } from './oauth-start-query';
import { oauthCallbackQuerySchema } from './oauth-callback-query';

describe('oauthStartQuery contract (REQ-ID-009)', () => {
  const valid: unknown[] = [{}, { redirect: 'http://localhost:3000/app' }];
  const invalid: unknown[] = [
    { redirect: 'http://localhost:3000/app', extra: true }, // strictObject
    { redirect: 42 },
    'not-an-object',
  ];
  it.each(valid.map((v) => [JSON.stringify(v), v] as const))('accepts %s', (_l, v) => {
    expect(oauthStartQuerySchema.safeParse(v).success).toBe(true);
  });
  it.each(invalid.map((v) => [JSON.stringify(v), v] as const))('rejects %s', (_l, v) => {
    expect(oauthStartQuerySchema.safeParse(v).success).toBe(false);
  });
});

describe('oauthCallbackQuery contract (REQ-ID-009)', () => {
  const valid: unknown[] = [
    { code: 'auth-code', state: 'csrf-state' },
    { error: 'access_denied' },
    {},
    // Google дописывает свои параметры в callback-URL (scope/authuser/prompt и т.п.) —
    // strict-отказ дал бы 400 REQUEST_INVALID на штатном входе (manual smoke 2026-09-24).
    {
      code: 'auth-code',
      state: 'csrf-state',
      scope: 'openid email profile',
      authuser: '0',
      prompt: 'consent',
    },
  ];
  const invalid: unknown[] = [
    // extra-ключи больше не отклоняются: схема strip'ит неизвестное (Google дописывает своё).
    { code: 42 },
    'not-an-object',
  ];
  it.each(valid.map((v) => [JSON.stringify(v), v] as const))('accepts %s', (_l, v) => {
    expect(oauthCallbackQuerySchema.safeParse(v).success).toBe(true);
  });
  it.each(invalid.map((v) => [JSON.stringify(v), v] as const))('rejects %s', (_l, v) => {
    expect(oauthCallbackQuerySchema.safeParse(v).success).toBe(false);
  });
});
