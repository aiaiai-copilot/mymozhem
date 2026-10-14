import { TEST_CONFIG } from '../testing/test-config';
import type { AppConfig } from '../config/config.schema';
import type { ReplyLike } from './http.types';
import { setRefreshCookie } from './refresh-cookie';

// Фейк ReplyLike: интересует только options.secure переданный в setCookie.
class FakeReply implements ReplyLike {
  cookieOptions: { secure: boolean } | null = null;
  setCookie(_name: string, _value: string, options: { secure: boolean }): unknown {
    this.cookieOptions = options;
    return this;
  }
  clearCookie(): unknown {
    return this;
  }
  redirect(): unknown {
    return this;
  }
}

const cfg = (over: Partial<AppConfig>): AppConfig => ({ ...TEST_CONFIG, ...over });

// Находка №2: LAN-стенд под NODE_ENV=production по plain HTTP — Secure-кука
// браузером не принимается. Флаг COOKIE_SECURE отделяет « Secure-атрибут» от
// NODE_ENV; дефолт auto = прежнее поведение (дизайн §2).
describe('setRefreshCookie + COOKIE_SECURE', () => {
  it.each([
    ['auto + production → secure', cfg({ COOKIE_SECURE: 'auto', NODE_ENV: 'production' }), true],
    ['auto + development → не secure', cfg({ COOKIE_SECURE: 'auto', NODE_ENV: 'development' }), false],
    ["'true' принудительно secure даже в development", cfg({ COOKIE_SECURE: 'true', NODE_ENV: 'development' }), true],
    ["'false' снимает secure даже в production (plain-HTTP LAN)", cfg({ COOKIE_SECURE: 'false', NODE_ENV: 'production' }), false],
  ] as const)('%s', (_label, config, expectedSecure) => {
    const reply = new FakeReply();
    setRefreshCookie(reply, 'refresh-token', config, 'REGISTERED');
    expect(reply.cookieOptions?.secure).toBe(expectedSecure);
  });
});
