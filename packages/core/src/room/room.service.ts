import { Injectable } from '@nestjs/common';
import type { Room, $Enums, Prisma } from '@prisma/client';
import type { CoreEventName } from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { EventLogService } from '../realtime/event-log.service';
import { AppRegistryService } from '../app-registry/app-registry.service';
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
  ) {}

  async create(organizerId: string): Promise<Room> {
    // REQ-ID-005: organizer must be a live REGISTERED identity. One atomic guarded
    // INSERT — the WHERE EXISTS predicate is the single source of truth, no
    // check-before-write (same philosophy as the guarded UPDATEs below). Race-safe
    // structurally: in phase 1 kind is immutable, later flips go GUEST→REGISTERED
    // only (REQ-ID-004), and no flow sets deletedAt on REGISTERED (design §3).
    // The same predicate lives in the "Identity_registered_email_key" index
    // condition (design §7) — change both or neither.
    // `updatedAt` is explicit: Prisma's @updatedAt is client-side, no DB default.
    const rows = await this.prisma.$queryRaw<Room[]>`
      INSERT INTO room."Room" ("id", "organizerId", "status", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), ${organizerId}::uuid, 'DRAFT', now(), now()
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
    return rows[0];
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

  async transition(roomId: string, to: RoomStatus): Promise<Room> {
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
        await this.eventLog.commitCoreEvent(tx, roomId, 'room.activated', {
          appId: updated.appId,
          manifestVersion: updated.manifestVersion,
        });
      } else {
        const eventName = LIFECYCLE_EVENTS[to];
        if (eventName) {
          await this.eventLog.commitCoreEvent(tx, roomId, eventName, {});
        }
      }
      return updated;
    });
  }

  activate(roomId: string): Promise<Room> {
    return this.transition(roomId, 'ACTIVE');
  }

  complete(roomId: string): Promise<Room> {
    return this.transition(roomId, 'COMPLETED');
  }

  cancel(roomId: string): Promise<Room> {
    return this.transition(roomId, 'CANCELLED');
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
