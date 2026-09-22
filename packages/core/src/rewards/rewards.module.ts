import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MembershipModule } from '../membership/membership.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AuthModule } from '../auth/auth.module';
import { RewardsService } from './rewards.service';
import { RewardsController } from './rewards.controller';
import { RewardsAnonymizationGuard } from './rewards-anonymization.guard';

// Контур rewards (design 2026-09-10 §2). Handler-провайдер диспетчера эффектов
// и @Global — Task 11. AuthModule — TokenService для Bearer-аутентификации
// контроллера (прецедент TransportModule). RewardsAnonymizationGuard экспортируется
// для связки ANONYMIZATION_GUARDS в composition root (REQ-RWD-013, hook, не импорт).
@Module({
  imports: [PrismaModule, MembershipModule, RealtimeModule, AuthModule],
  controllers: [RewardsController],
  providers: [RewardsService, RewardsAnonymizationGuard],
  exports: [RewardsService, RewardsAnonymizationGuard],
})
export class RewardsModule {}
