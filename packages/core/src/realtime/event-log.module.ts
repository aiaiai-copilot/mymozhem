import { Module } from '@nestjs/common';
import { MetricsModule } from '../observability/metrics.module';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { EventLogService } from './event-log.service';
import { EventEmitLimiter } from './event-emit-limiter';
import { RealtimeBus } from './realtime-bus';
import { EventOutbox } from './event-outbox';

// Event-log примитивы, вынесенные из RealtimeModule (дизайн UI-среза, Task 2):
// MembershipService коммитит core.member.joined в join-tx, а RealtimeModule
// импортирует MembershipModule (gateway) — прямая зависимость MembershipModule →
// RealtimeModule была бы циклом. socket.io здесь НЕ импортируется (REQ-RT-006:
// server-библиотека — только в gateway-коде RealtimeModule).
// AppRegistryService (зависимость EventLogService) — global из AppRegistryModule.register,
// поэтому в imports его нет. PrismaModule нужен EventOutbox'у (runner владеет
// транзакцией); сам примитив записи по-прежнему работает на транзакционном клиенте
// вызывающего — атомарность «действие + лог» (REQ-DEV-008) не меняется.
@Module({
  imports: [PrismaModule, ConfigModule, MetricsModule],
  providers: [
    {
      provide: EventEmitLimiter,
      useFactory: (config: AppConfig) => new EventEmitLimiter(config.EVENT_EMIT_RATE_LIMIT_PER_MIN),
      inject: [APP_CONFIG],
    },
    RealtimeBus,
    EventOutbox,
    EventLogService,
  ],
  exports: [RealtimeBus, EventOutbox, EventLogService, EventEmitLimiter],
})
export class EventLogModule {}
