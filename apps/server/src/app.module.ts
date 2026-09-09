import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AppRegistryModule.register([]),
    AppRuntimeModule.register([]), // пусто до Task 12 (quiz-модуль)
    RoomModule,
    IdentityModule,
    MembershipModule,
    RealtimeModule,
    TransportModule,
  ],
})
export class AppModule {}
