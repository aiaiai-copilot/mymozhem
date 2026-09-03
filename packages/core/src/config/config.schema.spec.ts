import { configSchema, loadConfig } from './config.schema';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', JWT_SECRET: 's'.repeat(32) };

describe('loadConfig', () => {
  it('applies defaults when only DATABASE_URL is provided', () => {
    const cfg = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(cfg.PORT).toBe(3000);
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.DATABASE_URL).toBe(base.DATABASE_URL);
  });

  it('coerces PORT from string', () => {
    const cfg = loadConfig({ ...base, PORT: '8080' } as NodeJS.ProcessEnv);
    expect(cfg.PORT).toBe(8080);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('throws when PORT is out of range', () => {
    expect(() => loadConfig({ ...base, PORT: '70000' } as NodeJS.ProcessEnv)).toThrow(/PORT/);
  });

  it('applies §4 defaults (REQ-ID-006, REQ-ID-013)', () => {
    const cfg = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(cfg.ROOM_CODE_MIN_LEN).toBe(8);
    expect(cfg.ROOM_PARTICIPANT_LIMIT).toBe(500);
    expect(cfg.JOIN_RATE_LIMIT_IP).toBe(20);
  });

  it.each([
    ['ROOM_CODE_MIN_LEN', '5'],
    ['ROOM_PARTICIPANT_LIMIT', '0'],
    ['ROOM_PARTICIPANT_LIMIT', '100001'],
    ['JOIN_RATE_LIMIT_IP', '0'],
  ] as const)('throws when %s is out of range (%s)', (key, value) => {
    expect(() => loadConfig({ ...base, [key]: value } as NodeJS.ProcessEnv)).toThrow(
      new RegExp(key),
    );
  });

  it('coerces §4 params from strings', () => {
    const cfg = loadConfig({
      ...base,
      ROOM_CODE_MIN_LEN: '10',
      JOIN_RATE_LIMIT_IP: '5',
    } as NodeJS.ProcessEnv);
    expect(cfg.ROOM_CODE_MIN_LEN).toBe(10);
    expect(cfg.JOIN_RATE_LIMIT_IP).toBe(5);
  });

  it('rejects a missing JWT_SECRET (REQ-SEC-002)', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: base.DATABASE_URL } as NodeJS.ProcessEnv),
    ).toThrow(/JWT_SECRET/);
  });

  it('rejects JWT_SECRET shorter than 32 bytes (REQ-SEC-002)', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(
      /JWT_SECRET/,
    );
  });

  it('accepts REFRESH_TOKEN_TTL > GUEST_TTL (guest cap применяется при выдаче, не в конфиге; design §5)', () => {
    const cfg = loadConfig({ ...base, GUEST_TTL: '86400', REFRESH_TOKEN_TTL: '2592000' } as NodeJS.ProcessEnv);
    expect(cfg.REFRESH_TOKEN_TTL).toBe(2_592_000);
  });

  it('rejects REFRESH_TOKEN_TTL below 1 day / above 90 days (§4)', () => {
    expect(() => loadConfig({ ...base, REFRESH_TOKEN_TTL: '3600' } as NodeJS.ProcessEnv)).toThrow(/REFRESH_TOKEN_TTL/);
    expect(() => loadConfig({ ...base, REFRESH_TOKEN_TTL: '8000000' } as NodeJS.ProcessEnv)).toThrow(/REFRESH_TOKEN_TTL/);
  });

  it('accepts absent Google section (optional, design §8)', () => {
    const cfg = loadConfig(base as NodeJS.ProcessEnv);
    expect(cfg.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(cfg.OAUTH_REDIRECT_ALLOWLIST).toEqual([]);
    expect(cfg.OAUTH_STATE_TTL).toBe(600);
    expect(cfg.OAUTH_RATE_LIMIT).toBe(10);
  });

  it('rejects partial Google section (all-or-none, REQ-OPS-003)', () => {
    expect(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: 'id' } as NodeJS.ProcessEnv)).toThrow(/GOOGLE/);
    expect(() =>
      loadConfig({ ...base, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' } as NodeJS.ProcessEnv),
    ).toThrow(/GOOGLE/);
  });

  it('requires non-empty OAUTH_REDIRECT_ALLOWLIST when Google is configured (REQ-ID-009)', () => {
    expect(() =>
      loadConfig({
        ...base,
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 's',
        OAUTH_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
      } as NodeJS.ProcessEnv),
    ).toThrow(/OAUTH_REDIRECT_ALLOWLIST/);
  });

  it('parses full Google section and allowlist transform', () => {
    const cfg = loadConfig({
      ...base,
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 's',
      OAUTH_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
      OAUTH_REDIRECT_ALLOWLIST: 'http://localhost:3000/app, http://localhost:3000/other',
    } as NodeJS.ProcessEnv);
    expect(cfg.OAUTH_REDIRECT_ALLOWLIST).toEqual(['http://localhost:3000/app', 'http://localhost:3000/other']);
  });

  it('rejects CORS wildcard in production (REQ-SEC-008)', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', CORS_ORIGINS: '*' } as NodeJS.ProcessEnv),
    ).toThrow(/CORS_ORIGINS/);
  });

  it('applies transport defaults', () => {
    const cfg = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(cfg.ACCESS_TOKEN_TTL).toBe(900);
    expect(cfg.GUEST_TTL).toBe(86400);
    expect(cfg.REFRESH_TOKEN_TTL).toBe(2_592_000);
    expect(cfg.REFRESH_RATE_LIMIT).toBe(10);
    expect(cfg.TRUST_PROXY).toBe(false);
    expect(cfg.CORS_ORIGINS).toEqual([]);
  });

  it('parses TRUST_PROXY and CORS_ORIGINS', () => {
    const cfg = loadConfig({
      ...base,
      TRUST_PROXY: 'true',
      CORS_ORIGINS: 'https://a.example, https://b.example',
    } as NodeJS.ProcessEnv);
    expect(cfg.TRUST_PROXY).toBe(true);
    expect(cfg.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });

  it('applies §4 defaults for event emission params', () => {
    const cfg = configSchema.parse({
      DATABASE_URL: 'postgresql://x',
      JWT_SECRET: 'x'.repeat(32),
    });
    expect(cfg.EVENT_EMIT_RATE_LIMIT_PER_MIN).toBe(30);
    expect(cfg.MAX_EVENT_PAYLOAD_BYTES).toBe(16_384);
  });

  it('rejects out-of-range event emission params (REQ-RT-012/014, §4 bounds)', () => {
    const envBase = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'x'.repeat(32) };
    expect(configSchema.safeParse({ ...envBase, EVENT_EMIT_RATE_LIMIT_PER_MIN: 0 }).success).toBe(false);
    expect(configSchema.safeParse({ ...envBase, MAX_EVENT_PAYLOAD_BYTES: 512 }).success).toBe(false);
    expect(configSchema.safeParse({ ...envBase, MAX_EVENT_PAYLOAD_BYTES: 300_000 }).success).toBe(false);
  });

  it('applies §4 default for reconnect ceiling (REQ-RT-015)', () => {
    const cfg = configSchema.parse({
      DATABASE_URL: 'postgresql://x',
      JWT_SECRET: 'x'.repeat(32),
    });
    expect(cfg.RECONNECT_RATE_LIMIT_PER_MIN).toBe(10);
  });

  it('coerces RECONNECT_RATE_LIMIT_PER_MIN from string and rejects 0', () => {
    const envBase = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'x'.repeat(32) };
    expect(
      configSchema.parse({ ...envBase, RECONNECT_RATE_LIMIT_PER_MIN: '5' })
        .RECONNECT_RATE_LIMIT_PER_MIN,
    ).toBe(5);
    expect(
      configSchema.safeParse({ ...envBase, RECONNECT_RATE_LIMIT_PER_MIN: 0 }).success,
    ).toBe(false);
  });
});
