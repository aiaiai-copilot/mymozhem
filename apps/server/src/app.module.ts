import { Module } from '@nestjs/common';
import {
  AppRegistryModule,
  HealthModule,
  PrismaModule,
  RealtimeModule,
  RoomModule,
} from '@mymozhem/core';

@Module({
  imports: [PrismaModule, HealthModule, AppRegistryModule, RoomModule, RealtimeModule],
})
export class AppModule {}
