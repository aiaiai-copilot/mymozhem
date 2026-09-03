import { Injectable } from '@nestjs/common';
import { Prisma, type Identity } from '@prisma/client';
import { displayNameSchema } from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { IDENTITY_ERROR_CODES, IdentityError } from './identity.errors';

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

  // REQ-ID-015: логин/регистрация по (provider, subject). Self-contained транзакция:
  // retry при гонке несовместим с чужой (поэтому без tx-параметра, в отличие от createGuest).
  // Email-политика (решение владельца, design §0.3): email пишется один раз при создании,
  // автолинка по email НЕТ — конфликт с живым REGISTERED → EMAIL_CONFLICT.
  //
  // Инвариант «change both or neither» (теперь трёх мест): предикат
  // kind='REGISTERED' AND deletedAt IS NULL — partial index "Identity_registered_email_key",
  // guarded INSERT RoomService.create и проверка конфликта ниже. Менять только вместе.
  async findOrCreateByProvider(input: {
    provider: string;
    subject: string;
    email: string;
    displayName?: string | undefined;
  }): Promise<Identity> {
    const where = { provider_subject: { provider: input.provider, subject: input.subject } };
    const existing = await this.prisma.identityProvider.findUnique({
      where,
      include: { identity: true },
    });
    if (existing) {
      if (existing.identity.deletedAt !== null) {
        throw new IdentityError(
          IDENTITY_ERROR_CODES.PROVIDER_IDENTITY_GONE,
          `identity ${existing.identityId} deleted`,
        );
      }
      return existing.identity;
    }
    const conflict = await this.prisma.identity.findFirst({
      where: { kind: 'REGISTERED', deletedAt: null, email: { equals: input.email, mode: 'insensitive' } },
    });
    if (conflict) {
      // Гонка первого логина, вторая форма: близнец закоммитился между нашим первым
      // findUnique и этой проверкой — тогда конфликтующая identity наша собственная,
      // и это повторный логин, а не чужой email (design §4). Read committed гарантирует:
      // раз identity победителя видна, его provider-строка тоже закоммичена.
      const twin = await this.prisma.identityProvider.findUnique({ where, include: { identity: true } });
      if (twin && twin.identity.deletedAt === null) return twin.identity;
      throw new IdentityError(
        IDENTITY_ERROR_CODES.EMAIL_CONFLICT,
        `email taken by identity ${conflict.id}`,
      );
    }
    const parsedName = input.displayName === undefined ? null : displayNameSchema.safeParse(input.displayName);
    const displayName = parsedName === null ? null : parsedName.success ? parsedName.data : null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const identity = await tx.identity.create({
          data: { kind: 'REGISTERED', email: input.email, displayName },
        });
        await tx.identityProvider.create({
          data: { provider: input.provider, subject: input.subject, email: input.email, identityId: identity.id },
        });
        return identity;
      });
    } catch (err) {
      // Гонка двух первых логинов одного аккаунта: проигравший ловит P2002 по
      // (provider, subject) и превращается в повторный логин (design §4).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.identityProvider.findUnique({ where, include: { identity: true } });
        if (winner) return winner.identity;
      }
      throw err;
    }
  }
}
