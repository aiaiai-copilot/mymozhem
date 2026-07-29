import { Injectable } from '@nestjs/common';
import type { Identity, Prisma } from '@prisma/client';
import { displayNameSchema } from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  // REQ-ID-003: a guest is created by room code + name. This is the first
  // identity-writing flow — the identity seam deferred this service to exactly here
  // (design §6 of the identity slice). displayName is validated by the SDK contract
  // schema; a ZodError propagates untyped — mapping it is the first transport's job
  // (REQ-SEC-006). `tx` lets callers join their transaction (guest join is atomic,
  // membership design §3).
  async createGuest(
    displayName: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Identity> {
    const name = displayNameSchema.parse(displayName);
    return tx.identity.create({ data: { kind: 'GUEST', displayName: name } });
  }
}
