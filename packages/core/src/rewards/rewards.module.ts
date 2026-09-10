import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MembershipModule } from '../membership/membership.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AuthModule } from '../auth/auth.module';
import { RewardsService } from './rewards.service';
import { RewardsController } from './rewards.controller';

// Контур rewards (design 2026-09-10 §2). Handler-провайдер диспетчера эффектов
// и @Global — Task 11. AuthModule — TokenService для Bearer-аутентификации
// контроллера (прецедент TransportModule).
@Module({
  imports: [PrismaModule, MembershipModule, RealtimeModule, AuthModule],
  controllers: [RewardsController],
  providers: [RewardsService],
  exports: [RewardsService],
})
export class RewardsModule {}
