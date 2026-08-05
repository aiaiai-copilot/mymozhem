import { Inject, Injectable } from '@nestjs/common';
import type { LogEvent, Prisma } from '@prisma/client';
import {
  CORE_EVENTS,
  ContractError,
  coreEventType,
  type CoreEventName,
  type Visibility,
} from '@mymozhem/sdk';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { EventEmitLimiter } from './event-emit-limiter';

// Append-only commit-примитив для событий комнаты. ЕДИНСТВЕННЫЙ путь записи в
// realtime."LogEvent" — оба публичных метода (core и app) сходятся в appendLocked.
// Критическая секция контрактуальна (SDK-дизайн §7, REQ-RT-007): вся валидация —
// ДО advisory lock, размер payload не влияет на исход гонки за seq.
// Конвенция порядка блокировок (HANDOFF «Долгоживущие ограничения»): advisory lock
// комнаты — всегда leaf-most; транзакция, захватившая его, после этого НЕ пишет
// в room."Room".
@Injectable()
export class EventLogService {
  constructor(
    private readonly appRegistry: AppRegistryService,
    private readonly emitLimiter: EventEmitLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async commitCoreEvent(
    tx: Prisma.TransactionClient,
    roomId: string,
    name: CoreEventName,
    payload: unknown = {},
    actorId: string | null = null,
  ): Promise<LogEvent> {
    const definition = CORE_EVENTS[name];
    const parsed = definition.schema.safeParse(payload);
    if (!parsed.success) {
      throw new ContractError(
        'EVENT_PAYLOAD_INVALID',
        `payload of ${coreEventType(name)} does not match its core schema`,
      );
    }
    return this.appendLocked(
      tx,
      roomId,
      coreEventType(name),
      parsed.data,
      actorId,
      definition.visibility,
      definition.version,
    );
  }

  // commitAppEvent добавляется Task 5 — шов дизайна §2.

  private async appendLocked(
    tx: Prisma.TransactionClient,
    roomId: string,
    type: string,
    payload: unknown,
    actorId: string | null,
    visibility: Visibility,
    schemaVersion: number,
  ): Promise<LogEvent> {
    // $executeRaw, не $queryRaw: pg_advisory_xact_lock возвращает void, а $queryRaw
    // пытается десериализовать колонку результата и падает на типе 'void'.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${roomId}, 0))`;
    const rows = await tx.$queryRaw<LogEvent[]>`
      INSERT INTO realtime."LogEvent"
        ("roomId", "seq", "type", "payload", "actorId", "visibility", "schemaVersion")
      SELECT ${roomId}::uuid,
             COALESCE(MAX("seq"), 0) + 1,
             ${type},
             ${JSON.stringify(payload)}::jsonb,
             ${actorId}::uuid,
             ${visibility}::realtime."EventVisibility",
             ${schemaVersion}
      FROM realtime."LogEvent"
      WHERE "roomId" = ${roomId}::uuid
      RETURNING *
    `;
    return rows[0];
  }
}
