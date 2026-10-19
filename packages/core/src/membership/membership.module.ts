import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '../config/config.module';
import { IdentityModule } from '../identity/identity.module';
import { PinoLoggerModule } from '../observability/pino-logger.module';
import { EventLogModule } from '../realtime/event-log.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { MembershipService } from './membership.service';
import { JoinRateLimiter } from './join-rate-limiter';

// EventLogModule — напрямую, не через RealtimeModule: RealtimeModule импортирует
// MembershipModule (gateway), обратная дуга была бы DI-циклом (дизайн UI-среза,
// Task 2). MembershipService коммитит core.member.joined в join-tx через
// EventLogService/EventOutbox.
@Module({
  imports: [PrismaModule, ConfigModule, IdentityModule, PinoLoggerModule, EventLogModule],
  providers: [
    {
      provide: JoinRateLimiter,
      useFactory: (config: AppConfig) => new JoinRateLimiter(config.JOIN_RATE_LIMIT_IP),
      inject: [APP_CONFIG],
    },
    MembershipService,
  ],
  exports: [MembershipService],
})
export class MembershipModule {}
