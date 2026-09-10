import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { MembershipModule } from '../membership/membership.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { EventLogService } from './event-log.service';
import { EventEmitLimiter } from './event-emit-limiter';
import { RealtimeBus } from './realtime-bus';
import { EventOutbox } from './event-outbox';
import { ProjectionService } from './projection.service';
import { SubscriptionRegistry } from './subscription-registry';
import { RealtimeGateway } from './realtime.gateway';
import { RECONNECT_RATE_LIMITER } from './realtime.tokens';

// PrismaModule нужен EventOutbox'у (runner владеет транзакцией); сам примитив
// записи по-прежнему работает на транзакционном клиенте вызывающего — атомарность
// «действие + лог» (REQ-DEV-008) не меняется. Единственный модуль ядра, импортирующий
// socket.io (REQ-RT-006 + boundary-правило).
@Module({
  imports: [ConfigModule, PrismaModule, AuthModule, MembershipModule],
  providers: [
    {
      provide: EventEmitLimiter,
      useFactory: (config: AppConfig) => new EventEmitLimiter(config.EVENT_EMIT_RATE_LIMIT_PER_MIN),
      inject: [APP_CONFIG],
    },
    {
      // REQ-RT-015 (объём v1.3): отдельный инстанс — состояние не делится с
      // join/refresh лимитерами; бэкофф/режимы — ф.4.
      provide: RECONNECT_RATE_LIMITER,
      useFactory: (config: AppConfig) => new JoinRateLimiter(config.RECONNECT_RATE_LIMIT_PER_MIN),
      inject: [APP_CONFIG],
    },
    RealtimeBus,
    EventOutbox,
    EventLogService,
    ProjectionService,
    SubscriptionRegistry,
    RealtimeGateway,
  ],
  exports: [EventLogService, EventOutbox],
})
export class RealtimeModule {}
