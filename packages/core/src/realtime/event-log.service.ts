import { Inject, Injectable } from '@nestjs/common';
import type { LogEvent, Prisma } from '@prisma/client';
import {
  CORE_EVENTS,
  ContractError,
  coreEventType,
  isWithinCeiling,
  type CoreEventName,
  type Visibility,
} from '@mymozhem/sdk';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { EventEmitLimiter } from './event-emit-limiter';
import {
  ActorNotMemberError,
  EventEmitRateLimitedError,
  EventPayloadInvalidError,
  EventPayloadTooLargeError,
  EventTypeUnknownError,
  EventVisibilityExceededError,
  RoomNotActiveError,
} from './realtime.errors';

// JSON-сериализация app-payload (шаг размера REQ-RT-012 и append). Несериализуемый
// payload (undefined, BigInt, циклические ссылки) — typed EVENT_PAYLOAD_INVALID,
// не сырой TypeError: отказ должен жить в таксономии design §6, а не утекать
// из цепочки как необработанное исключение рантайма.
function stringifyAppPayload(payload: unknown, eventType: string): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new EventPayloadInvalidError(`payload of ${eventType} is not JSON-serializable`);
  }
  if (serialized === undefined) {
    throw new EventPayloadInvalidError(`payload of ${eventType} is not JSON-serializable`);
  }
  return serialized;
}

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

  // Commit-цепочка app-событий (design §2): ВСЕ проверки до advisory lock —
  // payload-нейтральность гонки за seq контрактуальна (REQ-RT-007). Порядок шагов:
  // status-гейт → rate-limit → размер → реестр → схема → видимость → membership →
  // appendLocked. Дешёвые отказы раньше; запечатанная комната не жжёт лимит (шаг 1
  // до шага 2). actorId = null — серверная эмиссия приложения: membership-гейт и
  // per-actor лимит не применяются (design §0).
  async commitAppEvent(
    tx: Prisma.TransactionClient,
    roomId: string,
    name: string,
    payload: unknown,
    visibility: Visibility,
    actorId: string | null = null,
  ): Promise<LogEvent> {
    // 1. Status-гейт (REQ-RT-016): только ACTIVE с пином; DRAFT/терминальные/
    // удалённые/несуществующие — один код. Пин не-null в ACTIVE по гейту активации
    // (REQ-RT-004); проверка — fail-closed на случай рассогласования.
    const room = await tx.room.findUnique({ where: { id: roomId } });
    if (
      !room ||
      room.deletedAt !== null ||
      room.status !== 'ACTIVE' ||
      room.appId === null ||
      room.manifestVersion === null
    ) {
      throw new RoomNotActiveError(`Room ${roomId} is not ACTIVE (sealed, draft or not found)`);
    }
    const appId = room.appId;
    const manifestVersion = room.manifestVersion;
    // 2. Per-actor rate-limit (REQ-RT-014): считаются попытки, не только успехи.
    if (actorId !== null && !this.emitLimiter.tryAcquire(`${roomId}:${actorId}`)) {
      throw new EventEmitRateLimitedError(
        `Event emission rate limit exceeded for actor ${actorId} in room ${roomId}`,
      );
    }
    // 3. Размер (REQ-RT-012) — до реестра: дешевле и не требует manifest lookup.
    const serialized = stringifyAppPayload(payload, `${appId}.${name}`);
    if (Buffer.byteLength(serialized, 'utf8') > this.config.MAX_EVENT_PAYLOAD_BYTES) {
      throw new EventPayloadTooLargeError(
        `payload of ${appId}.${name} exceeds MAX_EVENT_PAYLOAD_BYTES (${this.config.MAX_EVENT_PAYLOAD_BYTES})`,
      );
    }
    // 4. Реестр (REQ-CTR-008): тип обязан существовать в пиннутом манифесте.
    const definition = this.appRegistry.getEventDefinition(appId, manifestVersion, name);
    if (!definition) {
      throw new EventTypeUnknownError(`No event type ${name} in manifest ${appId}@${manifestVersion}`);
    }
    // 5. Схема владельца типа (REQ-CTR-008) — verdict-only, без коэрсии (REQ-CORE-007).
    const validate = this.appRegistry.eventValidatorFor(appId, manifestVersion, name, definition.schema);
    if (!validate(payload)) {
      throw new EventPayloadInvalidError(
        `payload of ${appId}.${name} does not match its registered schema: ${this.appRegistry.describeEventErrors(validate)}`,
      );
    }
    // 6. Потолок видимости (REQ-CTR-009): слабее декларированного — отказ, строже — можно.
    if (!isWithinCeiling(visibility, definition.visibility)) {
      throw new EventVisibilityExceededError(
        `visibility ${visibility} exceeds declared ceiling ${definition.visibility} for ${appId}.${name}`,
      );
    }
    // 7. Membership-гейт (design §0): актор — член комнаты.
    if (actorId !== null) {
      const member = await tx.membership.findUnique({
        where: { roomId_identityId: { roomId, identityId: actorId } },
      });
      if (!member) {
        throw new ActorNotMemberError(`Identity ${actorId} is not a member of room ${roomId}`);
      }
    }
    // 8. Append: schemaVersion = пиннутый manifestVersion — версия схемы app-события.
    // recheckRoomActive: post-lock перепроверка статуса (см. appendLocked).
    return this.appendLocked(
      tx,
      roomId,
      `${appId}.${name}`,
      payload,
      actorId,
      visibility,
      manifestVersion,
      true,
    );
  }

  private async appendLocked(
    tx: Prisma.TransactionClient,
    roomId: string,
    type: string,
    payload: unknown,
    actorId: string | null,
    visibility: Visibility,
    schemaVersion: number,
    recheckRoomActive = false,
  ): Promise<LogEvent> {
    // $executeRaw, не $queryRaw: pg_advisory_xact_lock возвращает void, а $queryRaw
    // пытается десериализовать колонку результата и падает на типе 'void'.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${roomId}, 0))`;
    if (recheckRoomActive) {
      // REQ-RT-016, TOCTOU: pre-lock status-гейт (шаг 1) мог отработать по ещё
      // ACTIVE строке, пока конкурентный терминальный переход коммитил CANCELLED/
      // COMPLETED и освобождал этот lock — без перепроверки app-событие легло бы
      // в лог ПОСЛЕ запечатывания. Re-check внутри критической секции:
      // payload-независимый O(1), поэтому контракт нейтральности REQ-RT-007
      // (size-dependent валидация строго ДО lock) не нарушен — санкционированное
      // отступление от буквы design §2 («все проверки ДО lock»), решение владельца.
      // Отказ бросает до INSERT → tx откатывается, лог остаётся запечатанным.
      // Core-путь (commitCoreEvent) флаг не ставит: lifecycle-эмит сам держит
      // row-lock на room."Room" и проверку статуса ему добавлять нельзя — он
      // эмитит именно переходы ИЗ ACTIVE.
      const room = await tx.room.findUnique({ where: { id: roomId }, select: { status: true } });
      if (room?.status !== 'ACTIVE') {
        throw new RoomNotActiveError(
          `Room ${roomId} left ACTIVE while this commit waited for the room lock (sealed by a terminal transition)`,
        );
      }
    }
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
