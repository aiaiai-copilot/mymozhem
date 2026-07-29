import { loadConfig } from './config.schema';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

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
});
