import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RoomService } from './room.service';

@Module({
  imports: [PrismaModule],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}
