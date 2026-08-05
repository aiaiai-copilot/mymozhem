import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { EventLogService } from './event-log.service';
import { EventEmitLimiter } from './event-emit-limiter';

// PrismaModule намеренно НЕ импортируется: примитив работает на транзакционном
// клиенте вызывающего (атомарность «действие + лог», REQ-DEV-008).
@Module({
  imports: [ConfigModule, AppRegistryModule],
  providers: [
    {
      provide: EventEmitLimiter,
      useFactory: (config: AppConfig) => new EventEmitLimiter(config.EVENT_EMIT_RATE_LIMIT_PER_MIN),
      inject: [APP_CONFIG],
    },
    EventLogService,
  ],
  exports: [EventLogService],
})
export class RealtimeModule {}
