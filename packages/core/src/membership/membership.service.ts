import { Inject, Injectable } from '@nestjs/common';
import type { Identity, Membership, Prisma } from '@prisma/client';
import { displayNameSchema } from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { JoinRateLimiter } from './join-rate-limiter';
import {
  JoinRateLimitedError,
  RoomJoinDeniedError,
  RoomParticipantLimitReachedError,
} from './membership.errors';

export interface JoinResult {
  membership: Membership;
  identity: Identity;
}

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly joinRateLimiter: JoinRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

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

  // Guest join by room code + name (REQ-ID-003). Порядок проверок значим (design §3):
  // лимит по IP — ДО lookup комнаты, иначе перебор кодов не накапливает счётчик;
  // ветки «нет комнаты / удалена / терминальный статус / закрытая политика» свёрнуты
  // в один ROOM_JOIN_DENIED (REQ-ID-013).
  async join(params: { code: string; displayName: string; ip: string }): Promise<JoinResult> {
    if (!this.joinRateLimiter.tryAcquire(params.ip)) {
      throw new JoinRateLimitedError('Join rate limit exceeded');
    }
    // ZodError propagates untyped by design (§6) — mapping is the first transport's job.
    const name = displayNameSchema.parse(params.displayName);

    const room = await this.prisma.room.findUnique({ where: { code: params.code } });
    if (!room) {
      throw new RoomJoinDeniedError('no room for code');
    }
    if (room.deletedAt !== null) {
      throw new RoomJoinDeniedError(`room ${room.id} deleted`);
    }
    if (room.status === 'COMPLETED' || room.status === 'CANCELLED') {
      throw new RoomJoinDeniedError(`room ${room.id} status ${room.status}`);
    }
    if (room.joinPolicy !== 'GUESTS') {
      throw new RoomJoinDeniedError(`room ${room.id} policy ${room.joinPolicy}`);
    }

    // Гонка count-then-insert принята (design §1, развилка (б)): лимит анти-накруточный,
    // возможный перелёт на единицы; advisory lock здесь ничего ценного не защищает.
    const participantCount = await this.prisma.membership.count({
      where: { roomId: room.id, role: 'PARTICIPANT' },
    });
    if (participantCount >= this.config.ROOM_PARTICIPANT_LIMIT) {
      throw new RoomParticipantLimitReachedError(`room ${room.id} is full`);
    }

    return this.prisma.$transaction(async (tx) => {
      const identity = await this.identity.createGuest(name, tx);
      const membership = await tx.membership.create({
        data: { roomId: room.id, identityId: identity.id, role: 'PARTICIPANT' },
      });
      return { membership, identity };
    });
  }
}
