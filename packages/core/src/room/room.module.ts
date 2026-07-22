import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RoomService } from './room.service';

@Module({
  imports: [PrismaModule, RealtimeModule],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}
