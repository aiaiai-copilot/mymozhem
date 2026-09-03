import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { MembershipModule } from '../membership/membership.module';
import { AuthModule } from '../auth/auth.module';
import { OAuthModule } from '../oauth/oauth.module';
import { RoomModule } from '../room/room.module';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { JoinController } from './join.controller';
import { AuthController } from './auth.controller';
import { ExcludeController } from './exclude.controller';
import { OAuthController } from './oauth.controller';
import { RoomsController } from './rooms.controller';
import { HttpExceptionFilter } from './http-exception.filter';
import { OAUTH_CALLBACK_RATE_LIMITER, OAUTH_START_RATE_LIMITER, REFRESH_RATE_LIMITER } from './auth.tokens';

@Module({
  imports: [ConfigModule, MembershipModule, AuthModule, OAuthModule, RoomModule],
  controllers: [JoinController, AuthController, ExcludeController, OAuthController, RoomsController],
  providers: [
    // Единственная точка маппинга ошибка → HTTP для всего приложения (design §5).
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // Отдельный инстанс лимитера для refresh (REQ-SEC-007) — не делит состояние
    // с join-лимитером из MembershipModule.
    {
      provide: REFRESH_RATE_LIMITER,
      useFactory: (config: AppConfig) => new JoinRateLimiter(config.REFRESH_RATE_LIMIT),
      inject: [APP_CONFIG],
    },
    // Отдельные инстансы для OAuth start/callback (REQ-SEC-007) — состояние не
    // делится ни между собой, ни с join/refresh.
    {
      provide: OAUTH_START_RATE_LIMITER,
      useFactory: (config: AppConfig) => new JoinRateLimiter(config.OAUTH_RATE_LIMIT),
      inject: [APP_CONFIG],
    },
    {
      provide: OAUTH_CALLBACK_RATE_LIMITER,
      useFactory: (config: AppConfig) => new JoinRateLimiter(config.OAUTH_RATE_LIMIT),
      inject: [APP_CONFIG],
    },
  ],
})
export class TransportModule {}
