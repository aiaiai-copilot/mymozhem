import { Module } from '@nestjs/common';
import { createQuizApp } from '@mymozhem/app-quiz';
import {
  AppRegistryModule,
  AppRuntimeModule,
  HealthModule,
  IdentityModule,
  MembershipModule,
  PrismaModule,
  RealtimeModule,
  RoomModule,
  TransportModule,
} from '@mymozhem/core';

const quiz = createQuizApp();

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AppRegistryModule.register([quiz.manifest]),
    AppRuntimeModule.register([quiz.runtime]),
    RoomModule,
    IdentityModule,
    MembershipModule,
    RealtimeModule,
    TransportModule,
  ],
})
export class AppModule {}
