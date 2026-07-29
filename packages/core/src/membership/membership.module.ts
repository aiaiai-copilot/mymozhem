import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '../config/config.module';
import { IdentityModule } from '../identity/identity.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { MembershipService } from './membership.service';
import { JoinRateLimiter } from './join-rate-limiter';

@Module({
  imports: [PrismaModule, ConfigModule, IdentityModule],
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
