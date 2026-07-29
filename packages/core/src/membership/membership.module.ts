import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MembershipService } from './membership.service';

@Module({
  imports: [PrismaModule],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
