import type { AppConfig } from '../config/config.schema';
import { REFRESH_COOKIE } from '../auth/auth.constants';
import type { ReplyLike } from './http.types';

// httpOnly + SameSite=Strict + Path=/auth: кука не уходит никуда, кроме
// refresh-эндпоинта (REQ-ID-008). Secure — только в production (dev/e2e по http);
// флаг COOKIE_SECURE (находка №2) позволяет снять/выставить атрибут явно.
// maxAge повторяет sessionExpiry (design §5 — одна норма в двух местах, менять вместе):
// GUEST → min(REFRESH, GUEST_TTL) (REQ-ID-016); REGISTERED → REFRESH_TOKEN_TTL.
export function setRefreshCookie(
  reply: ReplyLike,
  refreshToken: string,
  config: AppConfig,
  kind: 'GUEST' | 'REGISTERED',
): void {
  const maxAge = kind === 'GUEST'
    ? Math.min(config.REFRESH_TOKEN_TTL, config.GUEST_TTL)
    : config.REFRESH_TOKEN_TTL;
  // COOKIE_SECURE (находка №2): auto — по NODE_ENV (прежняя норма), явное
  // значение побеждает (false — только plain-HTTP LAN, см. чеклист события).
  const secure =
    config.COOKIE_SECURE === 'auto'
      ? config.NODE_ENV === 'production'
      : config.COOKIE_SECURE === 'true';
  void reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/auth',
    maxAge,
  });
}
