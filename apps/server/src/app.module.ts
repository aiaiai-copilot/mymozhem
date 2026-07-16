import { Module } from '@nestjs/common';
import { HealthModule, PrismaModule } from '@mymozhem/core';

@Module({
  imports: [PrismaModule, HealthModule],
})
export class AppModule {}
