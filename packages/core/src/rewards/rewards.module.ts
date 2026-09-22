import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MembershipModule } from '../membership/membership.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AuthModule } from '../auth/auth.module';
import { AWARD_EFFECT_HANDLER } from '../app-runtime/effects';
import { RewardsService } from './rewards.service';
import { RewardsController } from './rewards.controller';
import { RewardsAnonymizationGuard } from './rewards-anonymization.guard';

// Контур rewards (design 2026-09-10 §2). AuthModule — TokenService для Bearer-
// аутентификации контроллера (прецедент TransportModule).
//
// @Global: AppRuntimeService (AppRuntimeModule, global) опционально инжектирует
// AWARD_EFFECT_HANDLER; identity-свип — ANONYMIZATION_GUARDS из composition root
// (apps/server/src/anonymization-guards.module.ts). Ядро rewards не импортирует
// (boundary rewards-only-through-di-tokens).
@Global()
@Module({
  imports: [PrismaModule, MembershipModule, RealtimeModule, AuthModule],
  controllers: [RewardsController],
  providers: [
    RewardsService,
    RewardsAnonymizationGuard,
    { provide: AWARD_EFFECT_HANDLER, useExisting: RewardsService },
  ],
  exports: [RewardsService, RewardsAnonymizationGuard, AWARD_EFFECT_HANDLER],
})
export class RewardsModule {}
