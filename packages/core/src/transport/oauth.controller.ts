import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import { oauthCallbackQuerySchema, oauthStartQuerySchema } from '@mymozhem/sdk';
import { OAuthService } from '../oauth/oauth.service';
import { OAUTH_PKCE_COOKIE, OAUTH_REDIRECT_COOKIE, OAUTH_STATE_COOKIE } from '../oauth/oauth.constants';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { JoinRateLimitedError } from '../membership/membership.errors';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { OAUTH_CALLBACK_RATE_LIMITER, OAUTH_START_RATE_LIMITER } from './auth.tokens';
import { setRefreshCookie } from './refresh-cookie';
import type { ReplyLike, RequestLike } from './http.types';

// Тонкий транспорт (design §3): rate-limit → схема → сервис → куки/redirect.
// Статусов не знает — ошибки уходят в фильтр. Access-токен в URL не попадает
// (REQ-ID-008): клиент после лендинга вызывает POST /auth/refresh.
@Controller('auth')
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    @Inject(OAUTH_START_RATE_LIMITER) private readonly startLimiter: JoinRateLimiter,
    @Inject(OAUTH_CALLBACK_RATE_LIMITER) private readonly callbackLimiter: JoinRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('google')
  start(@Query() query: unknown, @Req() req: RequestLike, @Res({ passthrough: true }) reply: ReplyLike): void {
    if (!this.startLimiter.tryAcquire(req.ip)) {
      throw new JoinRateLimitedError('oauth start rate limit exceeded');
    }
    const { redirect } = oauthStartQuerySchema.parse(query ?? {});
    const result = this.oauth.start(redirect);
    for (const cookie of result.cookies) this.setOAuthCookie(reply, cookie.name, cookie.value);
    // Fastify v5: redirect(url, code) — URL первым аргументом.
    void reply.redirect(result.authorizeUrl, 302);
  }

  @Get('google/callback')
  async callback(
    @Query() query: unknown,
    @Req() req: RequestLike,
    @Res({ passthrough: true }) reply: ReplyLike,
  ): Promise<void> {
    if (!this.callbackLimiter.tryAcquire(req.ip)) {
      throw new JoinRateLimitedError('oauth callback rate limit exceeded');
    }
    const q = oauthCallbackQuerySchema.parse(query ?? {});
    try {
      const result = await this.oauth.complete({
        code: q.code,
        state: q.state,
        error: q.error,
        cookies: req.cookies,
      });
      setRefreshCookie(reply, result.tokens.refreshToken, this.config, result.tokens.kind);
      this.clearOAuthCookies(reply);
      void reply.redirect(result.redirectTarget, 302);
    } catch (err) {
      // Одноразовость state: куки гасятся при любом исходе (design §3).
      this.clearOAuthCookies(reply);
      throw err;
    }
  }

  private setOAuthCookie(reply: ReplyLike, name: string, value: string): void {
    void reply.setCookie(name, value, {
      httpOnly: true,
      secure: this.config.NODE_ENV === 'production',
      // Lax, не Strict: браузер обязан прислать куки на возврате с Google —
      // top-level GET-навигация (design §3, осознанное отличие от refresh-куки).
      sameSite: 'lax',
      path: '/auth',
      maxAge: this.config.OAUTH_STATE_TTL,
    });
  }

  private clearOAuthCookies(reply: ReplyLike): void {
    for (const name of [OAUTH_STATE_COOKIE, OAUTH_PKCE_COOKIE, OAUTH_REDIRECT_COOKIE]) {
      void reply.clearCookie(name, { path: '/auth' });
    }
  }
}
