import { Module } from '@nestjs/common';
import { AppRegistryModule, HealthModule, PrismaModule } from '@mymozhem/core';

@Module({
  imports: [PrismaModule, HealthModule, AppRegistryModule],
})
export class AppModule {}
