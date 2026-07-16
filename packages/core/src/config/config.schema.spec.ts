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
});
