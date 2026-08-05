import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { EventLogService } from './event-log.service';
import { EventEmitLimiter } from './event-emit-limiter';
import { RealtimeBus } from './realtime-bus';
import { EventOutbox } from './event-outbox';

// PrismaModule нужен EventOutbox'у (runner владеет транзакцией); сам примитив
// записи по-прежнему работает на транзакционном клиенте вызывающего — атомарность
// «действие + лог» (REQ-DEV-008) не меняется.
@Module({
  imports: [ConfigModule, AppRegistryModule, PrismaModule],
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
  exports: [EventLogService, EventOutbox],
})
export class RealtimeModule {}
