import { Injectable } from '@nestjs/common';
import type { LogEvent, Prisma } from '@prisma/client';
import { CORE_EVENTS, ContractError, coreEventType, type CoreEventName } from '@mymozhem/sdk';

// Append-only commit-примитив для core-типов событий (design §3). ЕДИНСТВЕННЫЙ путь
// записи в realtime."LogEvent". Порядок шагов контрактуален (SDK-дизайн §7):
// валидация payload — ДО входа в критическую секцию, затем advisory lock на комнату
// и атомарное присвоение seq — размер payload не влияет на исход гонки (REQ-RT-007).
// Шаги 1–7 цепочки app-событий (sealing REQ-RT-016, размер REQ-RT-012, rate-limit
// REQ-RT-014, actorId из auth REQ-RT-009, реестр REQ-CTR-008) встают перед шагом 3
// без изменения шагов 3–4 — шов event-commit плана (design §10).
@Injectable()
export class EventLogService {
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
    // $executeRaw, не $queryRaw: pg_advisory_xact_lock возвращает void, а $queryRaw
    // пытается десериализовать колонку результата и падает на типе 'void'.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${roomId}, 0))`;
    const rows = await tx.$queryRaw<LogEvent[]>`
      INSERT INTO realtime."LogEvent"
        ("roomId", "seq", "type", "payload", "actorId", "visibility", "schemaVersion")
      SELECT ${roomId}::uuid,
             COALESCE(MAX("seq"), 0) + 1,
             ${coreEventType(name)},
             ${JSON.stringify(parsed.data)}::jsonb,
             ${actorId}::uuid,
             ${definition.visibility}::realtime."EventVisibility",
             ${definition.version}
      FROM realtime."LogEvent"
      WHERE "roomId" = ${roomId}::uuid
      RETURNING *
    `;
    return rows[0];
  }
}
