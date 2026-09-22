import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '../config/config.module';
import { IdentityService } from './identity.service';
import { GuestSweepService } from './guest-sweep.service';

// ConfigModule — APP_CONFIG для GuestSweepService (GUEST_TTL), по прецеденту
// AuthModule (TokenService). ConfigModule — статический синглтон по метатипу:
// повторный импорт в модулях-потребителях не плодит провайдер.
@Module({
  imports: [PrismaModule, ConfigModule],
  providers: [IdentityService, GuestSweepService],
  exports: [IdentityService, GuestSweepService],
})
export class IdentityModule {}
