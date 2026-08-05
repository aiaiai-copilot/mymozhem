import { Inject, Injectable } from '@nestjs/common';
import type { Room, $Enums, Prisma } from '@prisma/client';
import { roomJoinPolicySchema, type CoreEventName, type RoomJoinPolicy } from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { EventLogService } from '../realtime/event-log.service';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { MembershipService } from '../membership/membership.service';
import { generateRoomCode, isRoomCodeCollision } from './room-code';
import {
  assertTransition,
  assertDeletable,
  DELETABLE_STATUSES,
  type RoomStatus,
} from './room-state-machine';
import {
  RoomConflictError,
  RoomNotConfiguredError,
  RoomOrganizerNotRegisteredError,
  RoomSettingsFrozenError,
} from './room.errors';

// Compile-time parity assertion between the Prisma-generated enum and the domain union.
// `current.status as RoomStatus` below is a no-op cast only while the two stay identical;
// if a member is ever added to one side and not the other, this line fails to compile
// instead of the cast silently degrading `ROOM_TRANSITIONS[from]` to undefined at runtime.
type RoomStatusParity = [RoomStatus] extends [$Enums.RoomStatus]
  ? [$Enums.RoomStatus] extends [RoomStatus]
    ? true
    : never
  : never;
void (true satisfies RoomStatusParity);

// Терминальные переходы с пустым payload (REQ-RT-010). 'room.activated' — особая
// ветка в transition: его payload — пин (appId, manifestVersion) из замороженной
// строки (REQ-RT-004, design §5).
const LIFECYCLE_EVENTS: Partial<Record<RoomStatus, CoreEventName>> = {
  COMPLETED: 'room.completed',
  CANCELLED: 'room.cancelled',
};

@Injectable()
export class RoomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLog: EventLogService,
    private readonly appRegistry: AppRegistryService,
    private readonly membership: MembershipService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(organizerId: string, joinPolicy: RoomJoinPolicy = 'guests'): Promise<Room> {
    const policy = roomJoinPolicySchema.parse(joinPolicy);
    // Retry on code collision lives OUTSIDE any transaction: a failed statement aborts
    // the whole Postgres transaction, so retrying inside one is pointless.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateRoomCode(this.config.ROOM_CODE_MIN_LEN);
      try {
        // One transaction: room row + ORGANIZER membership land atomically
        // (REQ-ID-011, design §1) — a partial pair can never be observed.
        return await this.prisma.$transaction(async (tx) => {
          const room = await this.insertRoom(tx, organizerId, code, policy);
          await this.membership.createOrganizerMembership(tx, room.id, organizerId);
          return room;
        });
      } catch (e) {
        if (attempt < 2 && isRoomCodeCollision(e)) continue;
        throw e;
      }
    }
    throw new Error('unreachable: the retry loop exits via return or throw');
  }

  // REQ-ID-005: organizer must be a live REGISTERED identity. One atomic guarded
  // INSERT — the WHERE EXISTS predicate is the single source of truth, no
  // check-before-write (same philosophy as the guarded UPDATEs below). Race-safe
  // structurally: in phase 1 kind is immutable, later flips go GUEST→REGISTERED
  // only (REQ-ID-004), and no flow sets deletedAt on REGISTERED (design §3).
  // The same predicate lives in the "Identity_registered_email_key" index
  // condition (design §7) — change both or neither.
  // `updatedAt` is explicit: Prisma's @updatedAt is client-side, no DB default.
  private async insertRoom(
    tx: Prisma.TransactionClient,
    organizerId: string,
    code: string,
    joinPolicy: RoomJoinPolicy,
  ): Promise<Room> {
    const rows = await tx.$queryRaw<Room[]>`
      INSERT INTO room."Room" ("id", "organizerId", "status", "code", "joinPolicy", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), ${organizerId}::uuid, 'DRAFT', ${code}, ${joinPolicy}::"room"."RoomJoinPolicy", now(), now()
      WHERE EXISTS (
        SELECT 1 FROM identity."Identity"
        WHERE "id" = ${organizerId}::uuid
          AND "kind" = 'REGISTERED'
          AND "deletedAt" IS NULL
      )
      RETURNING *
    `;
    if (rows.length === 0) {
      throw new RoomOrganizerNotRegisteredError(
        `Organizer ${organizerId} is not a live REGISTERED identity`,
      );
    }
    // Re-read через клиент: $queryRaw отдаёт сырое DB-значение enum ('guests'), а
    // контракт метода — Prisma-имя ('GUESTS'); маппинг @map выполняет только клиент.
    return tx.room.findUniqueOrThrow({ where: { id: rows[0].id } });
  }

  // REQ-RT-004 write path: атомарная замена всей тройки (appId, manifestVersion,
  // appSettings) — промежуточного состояния не существует (design §4). Валидация ДО
  // обращения к БД (REQ-CORE-007); запись — guarded UPDATE: только DRAFT и не
  // удалённая. Заморозка активной комнаты — этот предикат, не флаг.
  async configure(
    roomId: string,
    config: { appId: string; manifestVersion: number; settings: unknown },
  ): Promise<Room> {
    this.appRegistry.validateSettings(config.appId, config.manifestVersion, config.settings);
    const res = await this.prisma.room.updateMany({
      where: { id: roomId, status: 'DRAFT', deletedAt: null },
      data: {
        appId: config.appId,
        manifestVersion: config.manifestVersion,
        // JSON Schema-валидированное значение — JSON; unknown → InputJsonValue безопасно.
        appSettings: config.settings as Prisma.InputJsonValue,
      },
    });
    if (res.count === 0) {
      // Re-read только для точности server-side message; код один (design §6).
      const existing = await this.prisma.room.findUnique({ where: { id: roomId } });
      const reason = !existing
        ? 'not found'
        : existing.deletedAt !== null
          ? 'deleted'
          : `status ${existing.status}`;
      throw new RoomSettingsFrozenError(`Room ${roomId} is not configurable: ${reason}`);
    }
    return this.prisma.room.findUniqueOrThrow({ where: { id: roomId } });
  }

  // actorId — актор перехода из auth-контекста вызывающего (REQ-RT-009); null у
  // вызывающих без auth-контекста (seed-скрипт, системные вызовы).
  async transition(roomId: string, to: RoomStatus, actorId: string | null = null): Promise<Room> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.room.findUnique({ where: { id: roomId } });
      if (!current || current.deletedAt !== null) {
        throw new RoomConflictError(`Room ${roomId} not found or deleted`);
      }
      // State-machine legality first — precise ROOM_TRANSITION_INVALID for an existing room.
      assertTransition(current.status as RoomStatus, to);
      // Atomic guarded update: correctness of the race rests on this WHERE, not on the
      // read above (REQ-RT-005; same DB-invariant philosophy as REQ-RWD-010).
      // Для активации это ещё и точка сериализации с configure: updateMany берёт
      // row-lock — конкурентный configure либо уже закоммичен (и виден в re-read
      // ниже), либо ждёт наш коммит и получает ROOM_SETTINGS_FROZEN (design §5).
      const res = await tx.room.updateMany({
        where: { id: roomId, status: current.status, deletedAt: null },
        data: { status: to },
      });
      if (res.count === 0) {
        // → rollback: ни перехода, ни события у проигравшего (REQ-DEV-008).
        throw new RoomConflictError(`Room ${roomId} changed concurrently`);
      }
      // Re-read ПОСЛЕ row-lock: снимок, который перевалидируется, пинится и эмитится.
      // Чтение пина из `current` (до лока) могло бы отдать в room.activated пин,
      // который конкурентный configure уже перезаписал, — событие ≠ состояние.
      const updated = await tx.room.findUniqueOrThrow({ where: { id: roomId } });
      if (to === 'ACTIVE') {
        // REQ-RT-004: активация требует сконфигурированной комнаты — payload
        // room.activated это пин, неконфигурированной он неоткуда взяться.
        // Отказ откатывает и переход, и событие (REQ-DEV-008).
        if (
          updated.appId === null ||
          updated.manifestVersion === null ||
          updated.appSettings === null
        ) {
          throw new RoomNotConfiguredError(`Room ${roomId} has no app configuration`);
        }
        // REQ-CORE-007: повторная валидация при DRAFT → ACTIVE. Реестр boot-time,
        // строка durable: редеплой мог убрать манифест или изменить схему версии.
        this.appRegistry.validateSettings(
          updated.appId,
          updated.manifestVersion,
          updated.appSettings,
        );
        // Эмит — последним в транзакции: advisory lock комнаты всегда leaf-most,
        // после его захвата room."Room" в этой транзакции не пишем (конвенция
        // порядка блокировок, HANDOFF «Долгоживущие ограничения»).
        await this.eventLog.commitCoreEvent(
          tx,
          roomId,
          'room.activated',
          {
            appId: updated.appId,
            manifestVersion: updated.manifestVersion,
          },
          actorId,
        );
      } else {
        const eventName = LIFECYCLE_EVENTS[to];
        if (eventName) {
          await this.eventLog.commitCoreEvent(tx, roomId, eventName, {}, actorId);
        }
      }
      return updated;
    });
  }

  activate(roomId: string, actorId: string | null = null): Promise<Room> {
    return this.transition(roomId, 'ACTIVE', actorId);
  }

  complete(roomId: string, actorId: string | null = null): Promise<Room> {
    return this.transition(roomId, 'COMPLETED', actorId);
  }

  cancel(roomId: string, actorId: string | null = null): Promise<Room> {
    return this.transition(roomId, 'CANCELLED', actorId);
  }

  async softDelete(roomId: string): Promise<Room> {
    const current = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!current || current.deletedAt !== null) {
      throw new RoomConflictError(`Room ${roomId} not found or already deleted`);
    }
    assertDeletable(current.status as RoomStatus);
    // Guard derived from the single source of truth (DELETABLE_STATUSES) rather than a
    // hardcoded `status: { not: 'ACTIVE' }`, so a future change to that set is enforced
    // here automatically instead of silently diverging from the SQL guard.
    const res = await this.prisma.room.updateMany({
      where: { id: roomId, deletedAt: null, status: { in: [...DELETABLE_STATUSES] } },
      data: { deletedAt: new Date() },
    });
    if (res.count === 0) {
      throw new RoomConflictError(`Room ${roomId} changed concurrently`);
    }
    return this.prisma.room.findUniqueOrThrow({ where: { id: roomId } });
  }
}
