import { Module } from '@nestjs/common';
import {
  AppRegistryModule,
  HealthModule,
  IdentityModule,
  MembershipModule,
  PrismaModule,
  RealtimeModule,
  RoomModule,
} from '@mymozhem/core';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AppRegistryModule,
    RoomModule,
    IdentityModule,
    MembershipModule,
    RealtimeModule,
  ],
})
export class AppModule {}
