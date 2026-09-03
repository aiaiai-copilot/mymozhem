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
  ];
  const invalid: unknown[] = [
    { code: 'auth-code', extra: true }, // strictObject
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
