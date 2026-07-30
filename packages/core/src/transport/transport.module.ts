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
    // Единственная точка маппинга ошибка → HTTP для всего приложения (design §5).
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // Отдельный инстанс лимитера для refresh (REQ-SEC-007) — не делит состояние
    // с join-лимитером из MembershipModule.
    {
      provide: REFRESH_RATE_LIMITER,
      useFactory: (config: AppConfig) => new JoinRateLimiter(config.REFRESH_RATE_LIMIT),
      inject: [APP_CONFIG],
    },
  ],
})
export class TransportModule {}
