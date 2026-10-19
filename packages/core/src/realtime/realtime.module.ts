import { Module } from '@nestjs/common';
import { MetricsModule } from '../observability/metrics.module';
import { PinoLoggerModule } from '../observability/pino-logger.module';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { MembershipModule } from '../membership/membership.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { EventLogModule } from './event-log.module';
import { ProjectionService } from './projection.service';
import { SubscriptionRegistry } from './subscription-registry';
import { RealtimeGateway } from './realtime.gateway';
import { RECONNECT_RATE_LIMITER } from './realtime.tokens';

// Единственный модуль ядра, импортирующий socket.io (REQ-RT-006 + boundary-правило).
// Event-log примитивы (RealtimeBus/EventOutbox/EventLogService/EventEmitLimiter) живут
// в EventLogModule и реэкспортируются отсюда — потребители (Room/Rewards/AppRuntime)
// не меняются; MembershipModule тянет их напрямую из EventLogModule без DI-цикла.
@Module({
  imports: [MetricsModule, ConfigModule, PrismaModule, AuthModule, MembershipModule, PinoLoggerModule, EventLogModule],
  providers: [
    {
      // REQ-RT-015 (объём v1.3): отдельный инстанс — состояние не делится с
      // join/refresh лимитерами; бэкофф/режимы — ф.4.
      provide: RECONNECT_RATE_LIMITER,
      useFactory: (config: AppConfig) => new JoinRateLimiter(config.RECONNECT_RATE_LIMIT_PER_MIN),
      inject: [APP_CONFIG],
    },
    ProjectionService,
    SubscriptionRegistry,
    RealtimeGateway,
  ],
  exports: [EventLogModule],
})
export class RealtimeModule {}
