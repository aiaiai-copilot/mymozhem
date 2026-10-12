import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AppEffect, CreatePrizeRequest } from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipService } from '../membership/membership.service';
import { ActorNotMemberError, ActorNotOrganizerError } from '../membership/membership.errors';
import { EventLogService } from '../realtime/event-log.service';
import { EventOutbox } from '../realtime/event-outbox';
import { RoomNotActiveError } from '../realtime/realtime.errors';
import type { AwardEffectHandler } from '../app-runtime/effects';
import {
  AwardUnknownError,
  IdentityAnonymizedError,
  PrizeFundExhaustedError,
  PrizeUnknownError,
  RewardAlreadyResolvedError,
} from './rewards.errors';

// Контур rewards (design 2026-09-10 §2/§3). Два входа:
// 1) executeEffects — из диспетчера app-runtime, ВНУТРИ его outbox.run (вложенный
//    run запрещён — поэтому tx приходит параметром); отказ → откат всей транзакции.
// 2) REST-методы (createPrize/listAwards/fulfill/revoke) — свои outbox.run.
// События rewards.* коммитятся в той же транзакции (лог — нотификация и аудит,
// ADR-005; таблицы остаются источником состояния).
// implements AwardEffectHandler: DI-шов REQ-RWD-001 — app-runtime знает только
// интерфейс; импорт типа rewards → app-runtime/effects разрешён boundary-правилом.
@Injectable()
export class RewardsService implements AwardEffectHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
    private readonly eventLog: EventLogService,
    private readonly outbox: EventOutbox,
  ) {}

  // --- Вход 1: эффекты из app-runtime (чужая транзакция) ---

  async executeEffects(
    tx: Prisma.TransactionClient,
    roomId: string,
    sourceAppId: string,
    effects: readonly AppEffect[],
  ): Promise<void> {
    for (const effect of effects) {
      if (effect.kind === 'award.prize') {
        await this.awardPrize(tx, roomId, sourceAppId, effect.prizeId, effect.winnerId);
      } else {
        // award.points (REQ-RWD-002b): ledger-запись без приза и фонда, события нет.
        await tx.pointsGrant.create({
          data: {
            roomId,
            identityId: effect.identityId,
            points: effect.points,
            reason: effect.reason ?? null,
            sourceAppId,
          },
        });
      }
    }
  }

  // Порядок «insert Award → декремент» (не наоборот): конфликт частичного индекса
  // — типизированный no-op (REQ-RWD-003), и он НЕ должен списывать фонд; отказ
  // декремента откатывает insert вместе со всей транзакцией (REQ-RWD-010).
  private async awardPrize(
    tx: Prisma.TransactionClient,
    roomId: string,
    sourceAppId: string,
    prizeId: string,
    winnerId: string,
  ): Promise<void> {
    const prize = await tx.prize.findFirst({ where: { id: prizeId, roomId } });
    if (!prize) throw new PrizeUnknownError(prizeId);
    // C-8.1 (ф.4, амендмент 2026-09-25): победитель не должен быть
    // анонимизирован/отсутствовать. Чтение БЛОКИРУЮЩЕЕ (FOR NO KEY UPDATE), в той
    // же tx, до INSERT: режим конфликтует сам с собой — в том числе с updateMany
    // свипа на строке identity — пути сериализуются, кто первым взял блокировку,
    // тот выиграл. Если строку держит свип, гард ждёт его коммита и перечитывает
    // последнюю закоммиченную версию (READ COMMITTED, EPQ) → видит deletedAt.
    // FK-проверка Award (FOR KEY SHARE) в механизме не участвует: с FOR NO KEY
    // UPDATE она не конфликтует. Отказ — типизированный, откатывает tx без
    // списания фонда (организатор перерозыгрышит).
    const winnerRows = await tx.$queryRaw<{ deletedAt: Date | null }[]>`
      SELECT "deletedAt" FROM identity."Identity" WHERE id = ${winnerId} FOR NO KEY UPDATE`;
    if (winnerRows.length === 0 || winnerRows[0].deletedAt !== null) {
      throw new IdentityAnonymizedError(winnerId);
    }
    // НЕ try/catch P2002: unique-violation абортит Postgres-транзакцию (25P02 на
    // каждый следующий statement, COMMIT молча откатывает) — в батче эффектов это
    // убило бы sibling-эффекты и коммиты событий. Дубль — не-возбуждающим
    // INSERT ... ON CONFLICT DO NOTHING по частичному индексу (REQ-RWD-003).
    // Не-nullable колонок без DB-дефолта, кроме перечисленных, в модели нет.
    const inserted = await tx.$executeRaw`
      INSERT INTO rewards."Award" (id, "roomId", "prizeId", "winnerId", "sourceAppId")
      VALUES (gen_random_uuid(), ${roomId}::uuid, ${prizeId}::uuid, ${winnerId}::uuid, ${sourceAppId})
      ON CONFLICT ("roomId", "prizeId", "winnerId") WHERE "status" IN ('AWARDED', 'FULFILLED') DO NOTHING`;
    if (inserted === 0) return; // сетевой повтор — no-op ДО декремента: фонд не тратим
    // id вставленной строки — перечиткой по ключу индекса (прецедент re-read —
    // insertRoom, HANDOFF: adapter-pg + RETURNING из raw INSERT надёжнее обходить).
    const award = await tx.award.findFirstOrThrow({
      where: { roomId, prizeId, winnerId, status: { in: ['AWARDED', 'FULFILLED'] } },
    });
    const decremented = await tx.$executeRaw`
      UPDATE rewards."Prize" SET quantity = quantity - 1, "updatedAt" = now()
      WHERE id = ${prizeId}::uuid AND quantity >= 1`;
    if (decremented === 0) throw new PrizeFundExhaustedError(prizeId); // откатит insert
    // REQ-SEC-009: payload — только id.
    await this.eventLog.commitRewardsEvent(tx, roomId, 'reward.awarded', {
      awardId: award.id,
      prizeId,
      winnerId,
      sourceAppId,
    });
  }

  // --- Вход 2: REST-контур организатора ---

  async createPrize(roomId: string, actorId: string, input: CreatePrizeRequest) {
    await this.assertOrganizer(roomId, actorId);
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    // Добавление призов — в не-терминальной комнате (design §2: призы добавляют
    // на ходу; fulfill/revoke при COMPLETED — отдельная норма REQ-RWD-009).
    if (!room || room.deletedAt !== null || (room.status !== 'DRAFT' && room.status !== 'ACTIVE')) {
      throw new RoomNotActiveError(`room ${roomId} does not accept new prizes`);
    }
    return this.prisma.prize.create({
      data: { roomId, name: input.name, quantity: input.quantity, quantityTotal: input.quantity },
    });
  }

  async listAwards(roomId: string, actorId: string) {
    await this.assertOrganizer(roomId, actorId);
    // REQ-RWD-009: организатор видит все награды, включая оставшиеся AWARDED
    // при COMPLETED — статус комнаты здесь сознательно не гейтится.
    return this.prisma.award.findMany({ where: { roomId }, orderBy: { createdAt: 'asc' } });
  }

  // Зеркало listAwards (UI-срез, GET /rooms/:id/prizes): консоли нужен prizeId и
  // остаток фонда для розыгрыша — GET /rooms/:id/rewards отдаёт только awards.
  // Статус комнаты так же сознательно не гейтится.
  async listPrizes(roomId: string, actorId: string) {
    await this.assertOrganizer(roomId, actorId);
    return this.prisma.prize.findMany({ where: { roomId }, orderBy: { createdAt: 'asc' } });
  }

  async fulfill(roomId: string, awardId: string, actorId: string) {
    return this.outbox.run(async (tx) => {
      await this.assertOrganizer(roomId, actorId);
      const award = await tx.award.findFirst({ where: { id: awardId, roomId } });
      if (!award) throw new AwardUnknownError(awardId);
      if (award.status === 'FULFILLED') return award; // типизированный no-op (REQ-RWD-007)
      if (award.status !== 'AWARDED') throw new RewardAlreadyResolvedError(awardId, award.status);
      const n = await tx.$executeRaw`
        UPDATE rewards."Award" SET status = 'FULFILLED', "fulfilledAt" = now()
        WHERE id = ${awardId}::uuid AND status = 'AWARDED'`;
      if (n === 0) return tx.award.findUniqueOrThrow({ where: { id: awardId } }); // гонка — перечитать
      await this.eventLog.commitRewardsEvent(tx, roomId, 'reward.fulfilled', { awardId }, actorId);
      return tx.award.findUniqueOrThrow({ where: { id: awardId } });
    });
  }

  async revoke(roomId: string, awardId: string, actorId: string) {
    return this.outbox.run(async (tx) => {
      await this.assertOrganizer(roomId, actorId);
      const award = await tx.award.findFirst({ where: { id: awardId, roomId } });
      if (!award) throw new AwardUnknownError(awardId);
      if (award.status === 'REVOKED') return award; // no-op: quantity НЕ возвращаем повторно
      if (award.status !== 'AWARDED') throw new RewardAlreadyResolvedError(awardId, award.status);
      const n = await tx.$executeRaw`
        UPDATE rewards."Award" SET status = 'REVOKED', "revokedAt" = now()
        WHERE id = ${awardId}::uuid AND status = 'AWARDED'`;
      if (n === 0) return tx.award.findUniqueOrThrow({ where: { id: awardId } }); // гонка
      // Возврат quantity — только если переход состоялся (двойной отзыв не
      // возвращает quantity дважды, REQ-RWD-007); у беспризовой награды возвращать нечего.
      if (award.prizeId !== null) {
        await tx.$executeRaw`
          UPDATE rewards."Prize" SET quantity = quantity + 1, "updatedAt" = now()
          WHERE id = ${award.prizeId}::uuid`;
      }
      await this.eventLog.commitRewardsEvent(tx, roomId, 'reward.revoked', { awardId }, actorId);
      return tx.award.findUniqueOrThrow({ where: { id: awardId } });
    });
  }

  // Проверка роли — в домене, не в транспорте (прецедент MembershipService.exclude).
  // Одноклиентная (рулинг контроллера): findActiveMembership не принимает tx и читает
  // своим клиентом вне транзакции — тот же прецедент, что exclude (проверка вне tx).
  private async assertOrganizer(roomId: string, actorId: string): Promise<void> {
    const membership = await this.membership.findActiveMembership(roomId, actorId);
    if (!membership) {
      throw new ActorNotMemberError(`identity ${actorId} is not a member of room ${roomId}`);
    }
    if (membership.role !== 'ORGANIZER') {
      throw new ActorNotOrganizerError(`identity ${actorId} is not the organizer of room ${roomId}`);
    }
  }
}
