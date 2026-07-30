import type { AppConfig } from '../config/config.schema';
import { REFRESH_COOKIE } from '../auth/auth.constants';
import type { ReplyLike } from './http.types';

// httpOnly + SameSite=Strict + Path=/auth: кука не уходит никуда, кроме
// refresh-эндпоинта (REQ-ID-008). Secure — только в production (dev/e2e по http).
// maxAge ограничен guest_ttl — гостевая сессия не переживает гостя (REQ-ID-016).
export function setRefreshCookie(reply: ReplyLike, refreshToken: string, config: AppConfig): void {
  void reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/auth',
    maxAge: Math.min(config.REFRESH_TOKEN_TTL, config.GUEST_TTL),
  });
}
