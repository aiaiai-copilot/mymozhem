import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MembershipModule } from '../membership/membership.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RewardsService } from './rewards.service';

// Контур rewards (design 2026-09-10 §2). Контроллер — Task 6; handler-провайдер
// диспетчера эффектов и @Global — Task 11.
@Module({
  imports: [PrismaModule, MembershipModule, RealtimeModule],
  providers: [RewardsService],
  exports: [RewardsService],
})
export class RewardsModule {}
