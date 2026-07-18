import { Module } from '@nestjs/common';
import { AppRegistryModule, HealthModule, PrismaModule, RoomModule } from '@mymozhem/core';

@Module({
  imports: [PrismaModule, HealthModule, AppRegistryModule, RoomModule],
})
export class AppModule {}
