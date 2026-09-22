import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { createQuizApp } from '@mymozhem/app-quiz';
import { createLotteryApp } from '@mymozhem/app-lottery';
import {
  AppRegistryModule,
  AppRuntimeModule,
  HealthModule,
  IdentityModule,
  IdentitySweepModule,
  MembershipModule,
  PrismaModule,
  RealtimeModule,
  RewardsModule,
  RoomModule,
  TransportModule,
} from '@mymozhem/core';
import { AnonymizationGuardsModule } from './anonymization-guards.module';

const quiz = createQuizApp();
const lottery = createLotteryApp();

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    ScheduleModule.forRoot(), // REQ-ID-010: регламентные джобы; одна реплика (REQ-OPS-005)
    AppRegistryModule.register([quiz.manifest, lottery.manifest]),
    AppRuntimeModule.register([quiz.runtime, lottery.runtime]),
    RoomModule,
    IdentityModule,
    MembershipModule,
    RealtimeModule,
    TransportModule,
    RewardsModule, // global: AWARD_EFFECT_HANDLER для app-runtime (REQ-RWD-001)
    IdentitySweepModule, // TTL-свип гостей (REQ-ID-003/014) с приостановкой (REQ-RWD-013)
    AnonymizationGuardsModule,
  ],
})
export class AppModule {}
