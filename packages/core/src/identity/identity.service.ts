import { Injectable } from '@nestjs/common';
import { Prisma, type Identity } from '@prisma/client';
import { displayNameSchema } from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';

// Инвариант «change all or none» (трёх мест): предикат
// kind='REGISTERED' AND deletedAt IS NULL — partial index "Identity_single_registered_key"
// (миграция), guarded create в findOrCreateOrganizer (T5) и WHERE EXISTS в
// RoomService.insertRoom (REQ-ID-005). Менять только вместе.
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

  // ADR-012 §2: единственный REGISTERED инстанса, email = NULL. Гонка первых
  // bootstrap'ов: проигравший ловит P2002 от "Identity_single_registered_key" и
  // перечитывает победителя. create ВНЕ $transaction — catch P2002 не отравляет
  // чужую tx (ловушка aborted-tx). Инвариант — см. комментарий у шапки сервиса.
  async findOrCreateOrganizer(): Promise<Identity> {
    const existing = await this.prisma.identity.findFirst({
      where: { kind: 'REGISTERED', deletedAt: null },
    });
    if (existing) return existing;
    try {
      return await this.prisma.identity.create({
        data: { kind: 'REGISTERED', displayName: 'Организатор' },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.identity.findFirst({
          where: { kind: 'REGISTERED', deletedAt: null },
        });
        if (winner) return winner;
      }
      throw err;
    }
  }
}
