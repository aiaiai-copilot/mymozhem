### Task 8: TransportModule — контроллеры join/refresh и wiring

**REQ:** REQ-ID-003 (join), REQ-ID-008 (cookie), REQ-ID-016 (выдача пары), REQ-SEC-007 (refresh rate-limit), REQ-ID-013.

**Files:**
- Create: `packages/core/src/transport/auth.tokens.ts`
- Create: `packages/core/src/transport/refresh-cookie.ts`
- Create: `packages/core/src/transport/join.controller.ts`
- Create: `packages/core/src/transport/auth.controller.ts`
- Create: `packages/core/src/transport/transport.module.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `MembershipService.join` (→ `{ membership, identity }`), `TokenService` (`issueGuestTokens`, `rotate`), `JoinRateLimiter`, `HttpExceptionFilter`, `REFRESH_COOKIE`, SDK `joinRequestSchema`, `TokenResponse`.
- Produces: `TransportModule` (импортируется в `AppModule` в Task 9); `REFRESH_RATE_LIMITER` token.

- [ ] **Step 1: auth.tokens.ts + refresh-cookie.ts + контроллеры**

`auth.tokens.ts`:
```ts
// Отдельный инстанс лимитера для refresh-эндпоинта (REQ-SEC-007) — не делит состояние
// с join-лимитером.
export const REFRESH_RATE_LIMITER = Symbol('REFRESH_RATE_LIMITER');
```

`refresh-cookie.ts` (общий хелпер обоих контроллеров):
```ts
import type { FastifyReply } from 'fastify';
import type { AppConfig } from '../config/config.schema';
import { REFRESH_COOKIE } from '../auth/auth.constants';

// httpOnly + SameSite=Strict + Path=/auth: кука не уходит никуда, кроме
// refresh-эндпоинта (REQ-ID-008). Secure — только в production (dev/e2e по http).
export function setRefreshCookie(reply: FastifyReply, refreshToken: string, config: AppConfig): void {
  void reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/auth',
    maxAge: Math.min(config.REFRESH_TOKEN_TTL, config.GUEST_TTL),
  });
}
```

`join.controller.ts`:
```ts
import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { joinRequestSchema, type TokenResponse } from '@mymozhem/sdk';
import { MembershipService } from '../membership/membership.service';
import { TokenService } from '../auth/token.service';
import { setRefreshCookie } from './refresh-cookie';
import { APP_CONFIG } from '../config/config.tokens';
import { Inject } from '@nestjs/common';
import type { AppConfig } from '../config/config.schema';

@Controller()
export class JoinController {
  constructor(
    private readonly membership: MembershipService,
    private readonly tokens: TokenService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // actorId НЕ принимается из payload — актор определяется только выданным токеном
  // (REQ-RT-009 по духу для HTTP). ZodError/доменные ошибки уходят в фильтр.
  @Post('rooms/join')
  async join(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenResponse> {
    const { code, displayName } = joinRequestSchema.parse(body);
    const { identity, membership } = await this.membership.join({ code, displayName, ip: req.ip });
    const issued = await this.tokens.issueGuestTokens(identity.id, membership.roomId);
    setRefreshCookie(reply, issued.refreshToken, this.config);
    return { accessToken: issued.accessToken, tokenType: 'Bearer', expiresIn: issued.expiresIn };
  }
}
```

`auth.controller.ts`:
```ts
import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
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

@Controller('auth')
export class AuthController {
  constructor(
    private readonly tokens: TokenService,
    @Inject(REFRESH_RATE_LIMITER) private readonly refreshRateLimiter: JoinRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenResponse> {
    if (!this.refreshRateLimiter.tryAcquire(req.ip)) {
      throw new JoinRateLimitedError('refresh rate limit exceeded'); // wire: 429 RATE_LIMITED
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
```

`transport.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { MembershipModule } from '../membership/membership.module';
import { AuthModule } from '../auth/auth.module';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { JoinController } from './join.controller';
import { AuthController } from './auth.controller';
import { HttpExceptionFilter } from './http-exception.filter';
import { REFRESH_RATE_LIMITER } from './auth.tokens';

@Module({
  imports: [ConfigModule, MembershipModule, AuthModule],
  controllers: [JoinController, AuthController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    {
      provide: REFRESH_RATE_LIMITER,
      useFactory: (config: AppConfig) => new JoinRateLimiter(config.REFRESH_RATE_LIMIT),
      inject: [APP_CONFIG],
    },
  ],
})
export class TransportModule {}
```

Экспорты в `index.ts`:
```ts
export * from './transport/transport.module';
export * from './transport/http-exception.filter';
export * from './transport/auth.tokens';
```

- [ ] **Step 2: typecheck + lint + вся unit-лана core — зелёно** (контроллеры покрываются e2e в Task 10; юнит-тестов на них нет — осознанно, логика в сервисах)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/transport packages/core/src/index.ts
git commit -m "feat(core): transport module with join/refresh controllers (REQ-ID-003, REQ-ID-008, REQ-SEC-007)"
```

---

