import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { ConfigModule } from '../config/config.module';
import { MembershipModule } from '../membership/membership.module';
import { RoomService } from './room.service';

@Module({
  imports: [PrismaModule, RealtimeModule, AppRegistryModule, ConfigModule, MembershipModule],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}
