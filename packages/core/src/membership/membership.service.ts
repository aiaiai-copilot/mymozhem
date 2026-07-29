import { Injectable } from '@nestjs/common';
import type { Membership, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  // Called by RoomService.create inside its transaction: the organizer becomes the
  // room's first member (design §1). A violation of the partial unique index
  // "Membership_single_organizer_key" rolls the room insert back too.
  async createOrganizerMembership(
    tx: Prisma.TransactionClient,
    roomId: string,
    identityId: string,
  ): Promise<Membership> {
    return tx.membership.create({
      data: { roomId, identityId, role: 'ORGANIZER' },
    });
  }
}
