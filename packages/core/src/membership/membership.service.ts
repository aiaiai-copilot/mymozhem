import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Identity, Membership, Prisma } from '@prisma/client';
import { displayNameSchema } from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { JoinRateLimiter } from './join-rate-limiter';
import {
  ActorNotMemberError,
  ActorNotOrganizerError,
  JoinRateLimitedError,
  RoomJoinDeniedError,
  RoomParticipantLimitReachedError,
  TargetNotExcludableError,
  TargetNotMemberError,
} from './membership.errors';

export interface JoinResult {
  membership: Membership;
  identity: Identity;
}

// void | Promise<void>: sync-обработчики (RealtimeGateway.revokeRoomAccess) остаются
// совместимыми; async-обработчик тоже легален — его rejection изолируется в exclude.
export type AccessRevokedHandler = (identityId: string, roomId: string) => void | Promise<void>;

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly joinRateLimiter: JoinRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private readonly logger = new Logger(MembershipService.name);
  // Реестр обработчиков отзыва доступа (REQ-SEC-003): realtime-модуль подписывает
  // RealtimeGateway.revokeRoomAccess при инициализации (паттерн RealtimeBus.subscribe).
  // In-memory легален при одной реплике (REQ-OPS-005); состояние — поле экземпляра
  // (REQ-CORE-004). Любой вызывающий exclude получает разрыв подписок структурно.
  private readonly accessRevokedHandlers: AccessRevokedHandler[] = [];

  onAccessRevoked(handler: AccessRevokedHandler): void {
    this.accessRevokedHandlers.push(handler);
  }

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

  // Read-path (REQ-SEC-003): живое членство в живой комнате. Мягкое удаление
  // комнаты И мягкое удаление самой membership (исключение, срез исключения)
  // гасят членство для чтения — проверка непрерывна, не единовременна.
  async findActiveMembership(roomId: string, identityId: string): Promise<Membership | null> {
    const membership = await this.prisma.membership.findUnique({
      where: { roomId_identityId: { roomId, identityId } },
      include: { room: true },
    });
    if (!membership || membership.deletedAt !== null || membership.room.deletedAt !== null) return null;
    return membership;
  }

  // Исключение участника организатором (REQ-ID-006 ч.3): soft-delete membership,
  // запись Exclusion (rejoin-блок по IP), отзыв guest-сессий; пост-коммит —
  // немедленный разрыв подписок через hook (REQ-SEC-003). Порядок гейтов значим
  // (дизайн §3). Повтор — типизированный no-op (дизайн §0.4).
  async exclude(params: {
    roomId: string;
    targetIdentityId: string;
    actorId: string;
    reason?: string;
  }): Promise<{ excluded: boolean }> {
    const actor = await this.findActiveMembership(params.roomId, params.actorId);
    if (!actor) {
      throw new ActorNotMemberError(`actor ${params.actorId} is not a member of room ${params.roomId}`);
    }
    if (actor.role !== 'ORGANIZER') {
      throw new ActorNotOrganizerError(`actor ${params.actorId} is not ORGANIZER of room ${params.roomId}`);
    }
    const target = await this.prisma.membership.findUnique({
      where: { roomId_identityId: { roomId: params.roomId, identityId: params.targetIdentityId } },
      include: { identity: true },
    });
    if (!target) {
      throw new TargetNotMemberError(`target ${params.targetIdentityId} is not a member of room ${params.roomId}`);
    }
    if (target.deletedAt !== null) return { excluded: false };
    if (target.role === 'ORGANIZER') {
      throw new TargetNotExcludableError(`ORGANIZER of room ${params.roomId} cannot be excluded`);
    }
    // Инвариант: не-ORGANIZER membership всегда имеет joinIp (пишется в join).
    if (target.joinIp === null) {
      throw new Error(`invariant violated: non-organizer membership ${target.id} without joinIp`);
    }
    const joinIp = target.joinIp;
    await this.prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: target.id }, data: { deletedAt: new Date() } });
      await tx.exclusion.create({
        data: {
          roomId: params.roomId,
          identityId: params.targetIdentityId,
          ip: joinIp,
          excludedBy: params.actorId,
          reason: params.reason ?? null,
        },
      });
      // Отзыв сессий — только гостю (дизайн §0.2): гостевая identity однокомнатная.
      if (target.identity.kind === 'GUEST') {
        await tx.session.updateMany({
          where: { identityId: params.targetIdentityId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });
    // Пост-коммит: изоляция per-handler (прецедент fanOut) — ни sync-бросок, ни
    // async-rejection слушателя не валят запрос после коммита (await в try ловит оба;
    // unhandled rejection — а на современном Node это падение процесса — невозможен);
    // сигнал — в серверном логе.
    for (const handler of this.accessRevokedHandlers) {
      try {
        await handler(params.targetIdentityId, params.roomId);
      } catch (err) {
        this.logger.error(
          `access-revoked handler failed for ${params.targetIdentityId} in ${params.roomId}: ${(err as Error).message}`,
        );
      }
    }
    return { excluded: true };
  }

  // Guest join by room code + name (REQ-ID-003). Порядок проверок значим (design §3):
  // лимит по IP — ДО lookup комнаты, иначе перебор кодов не накапливает счётчик;
  // ветки «нет комнаты / удалена / терминальный статус / закрытая политика» свёрнуты
  // в один ROOM_JOIN_DENIED (REQ-ID-013).
  async join(params: { code: string; displayName: string; ip: string; role?: 'participant' | 'spectator' }): Promise<JoinResult> {
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

    // Rejoin-блок исключённых (REQ-ID-006 ч.3): свёрнут в тот же ROOM_JOIN_DENIED —
    // факт исключения не раскрывается (REQ-ID-013). Обход сменой сети —
    // задокументированный лимит нормы; device-cookie-признак — шов (дизайн §9).
    const excluded = await this.prisma.exclusion.findFirst({
      where: { roomId: room.id, ip: params.ip },
    });
    if (excluded) {
      throw new RoomJoinDeniedError(`ip excluded from room ${room.id}`);
    }

    // Гонка count-then-insert принята (design §1, развилка (б)): лимит анти-накруточный,
    // возможный перелёт на единицы; advisory lock здесь ничего ценного не защищает.
    // Считаются только живые membership (deletedAt: null) — исключённый участник
    // не занимает слот лимита навсегда (REQ-SEC-003, ruling контроллера).
    // Лимит — только на участников (REQ-ID-011): зритель слота не занимает и вход
    // в заполненную участниками комнату ему не закрыт (зритель не нагружает арбитраж).
    if (params.role !== 'spectator') {
      const participantCount = await this.prisma.membership.count({
        where: { roomId: room.id, role: 'PARTICIPANT', deletedAt: null },
      });
      if (participantCount >= this.config.ROOM_PARTICIPANT_LIMIT) {
        throw new RoomParticipantLimitReachedError(`room ${room.id} is full`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const identity = await this.identity.createGuest(name, tx);
      const membership = await tx.membership.create({
        data: {
          roomId: room.id,
          identityId: identity.id,
          joinIp: params.ip,
          // REQ-ID-011: самоназначение зрителем (фаза 2). Только два wire-значения
          // (SDK-схема), маппинг здесь — единственная точка.
          role: params.role === 'spectator' ? 'SPECTATOR' : 'PARTICIPANT',
        },
      });
      return { membership, identity };
    });
  }
}
