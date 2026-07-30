import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { TokenResponse } from '@mymozhem/sdk';
import { TokenService } from '../auth/token.service';
import { AUTH_ERROR_CODES, AuthError } from '../auth/auth.errors';
import { REFRESH_COOKIE } from '../auth/auth.constants';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { JoinRateLimitedError } from '../membership/membership.errors';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { REFRESH_RATE_LIMITER } from './auth.tokens';
import { setRefreshCookie } from './refresh-cookie';
import type { ReplyLike, RequestLike } from './http.types';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly tokens: TokenService,
    @Inject(REFRESH_RATE_LIMITER) private readonly refreshRateLimiter: JoinRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // Refresh принимает токен ТОЛЬКО из httpOnly-куки (REQ-ID-008) — тела у запроса нет.
  // Rate-limit per IP до любой работы с токеном (REQ-SEC-007); все отказы ротации
  // неразличимы снаружи (SESSION_INVALID, фильтр → 401).
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: RequestLike,
    @Res({ passthrough: true }) reply: ReplyLike,
  ): Promise<TokenResponse> {
    if (!this.refreshRateLimiter.tryAcquire(req.ip)) {
      throw new JoinRateLimitedError('refresh rate limit exceeded'); // фильтр: 429 RATE_LIMITED
    }
    const refreshToken = req.cookies[REFRESH_COOKIE];
    if (!refreshToken) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'no refresh cookie');
    }
    const issued = await this.tokens.rotate(refreshToken);
    setRefreshCookie(reply, issued.refreshToken, this.config);
    return { accessToken: issued.accessToken, tokenType: 'Bearer', expiresIn: issued.expiresIn };
  }
}
