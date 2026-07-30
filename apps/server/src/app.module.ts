import { Module } from '@nestjs/common';
import {
  AppRegistryModule,
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
    AppRegistryModule,
    RoomModule,
    IdentityModule,
    MembershipModule,
    RealtimeModule,
    TransportModule,
  ],
})
export class AppModule {}
