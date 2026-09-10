import { Inject, Injectable } from '@nestjs/common';
import {
  appCommitSchema,
  ContractError,
  type AppHostContext,
  type AppLogEvent,
  type AppRuntimeModule,
} from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipService } from '../membership/membership.service';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { EventLogService } from '../realtime/event-log.service';
import { EventOutbox } from '../realtime/event-outbox';
import { EventPayloadInvalidError, RoomNotActiveError } from '../realtime/realtime.errors';
import { AppModuleUnavailableError, PublishForbiddenError } from './app-runtime.errors';
import { RoomSerializer } from './room-serializer';
import { AppProjectionCache } from './app-projection-cache';
import { APP_RUNTIME_MODULES, type RegisteredRuntimeModules } from './app-runtime.tokens';

// Командный хост (design 2026-09-09 §2): клиентский publish app-типа исполняется
// модулем ДО коммита; модуль возвращает события или бросает типизированный отказ.
// Все гейты записи (схема владельца, visibility ceiling, rate-limit, status, seal)
// остаются в commitAppEvent — диспетчер их не дублирует и не обходит.
@Injectable()
export class AppRuntimeService {
  private readonly serializer = new RoomSerializer();

  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
    private readonly appRegistry: AppRegistryService,
    private readonly eventLog: EventLogService,
    private readonly outbox: EventOutbox,
    private readonly projections: AppProjectionCache,
    @Inject(APP_RUNTIME_MODULES) private readonly modules: RegisteredRuntimeModules,
  ) {}

  invalidateProjection(roomId: string): void {
    this.projections.invalidate(roomId);
  }

  async dispatch(params: {
    roomId: string;
    actorId: string;
    appId: string;
    shortName: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.serializer.run(params.roomId, () => this.dispatchLocked(params));
  }

  private async dispatchLocked(params: {
    roomId: string;
    actorId: string;
    appId: string;
    shortName: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    // 1. Комната ACTIVE с пином (REQ-RT-004/016) — до вызова модуля: модуль не
    //    должен наблюдать запечатанную комнату. Тот же гейт повторит commit.
    const room = await this.prisma.room.findUnique({ where: { id: params.roomId } });
    if (
      !room ||
      room.deletedAt !== null ||
      room.status !== 'ACTIVE' ||
      room.appId === null ||
      room.manifestVersion === null
    ) {
      throw new RoomNotActiveError(`Room ${params.roomId} is not ACTIVE (sealed, draft or not found)`);
    }
    if (room.appId !== params.appId) {
      throw new ContractError('EVENT_UNKNOWN_TYPE', `room ${params.roomId} is pinned to ${room.appId}, not ${params.appId}`);
    }
    // 2. Членство и роль (REQ-ID-011): SPECTATOR читает, но не publish'ит — гейт
    //    ядра, до вызова модуля.
    const membership = await this.membership.findActiveMembership(params.roomId, params.actorId);
    if (!membership) {
      throw new ContractError('ACTOR_NOT_MEMBER', `identity ${params.actorId} is not a member of room ${params.roomId}`);
    }
    if (membership.role === 'SPECTATOR') {
      throw new PublishForbiddenError('SPECTATOR cannot publish app events');
    }
    // 3. Модуль по пину комнаты. Нет модуля — fail-closed.
    const mod = this.modules.find(
      (m) => m.appId === room.appId && m.manifestVersion === room.manifestVersion,
    );
    if (!mod) {
      throw new AppModuleUnavailableError(room.appId, room.manifestVersion);
    }
    // 4. Тип — клиентская команда пиннутого манифеста. Производные типы клиенту закрыты.
    const eventDef = this.appRegistry.getEventDefinition(room.appId, room.manifestVersion, params.shortName);
    if (!eventDef) {
      throw new ContractError('EVENT_UNKNOWN_TYPE', `no event type ${params.shortName} in manifest ${room.appId}@${room.manifestVersion}`);
    }
    if (!eventDef.clientInitiated) {
      throw new PublishForbiddenError(`event type ${params.shortName} is not client-initiated`);
    }
    // 5. Вход валидируется схемой владельца ДО вызова модуля (REQ-RT-009): handler
    //    читает payload для решений — malformed вход не должен становиться TypeError.
    const validate = this.appRegistry.eventValidatorFor(room.appId, room.manifestVersion, params.shortName, eventDef.schema);
    if (!validate(params.payload)) {
      throw new EventPayloadInvalidError(
        `payload of ${room.appId}.${params.shortName} does not match its registered schema: ${this.appRegistry.describeEventErrors(validate)}`,
      );
    }
    // 6. Проекция: тёплый кэш или replay лога (module-private включительно —
    //    серверный путь, не клиентский канал).
    const state = await this.projectionFor(mod, params.roomId);
    const ctx: AppHostContext<unknown> = {
      roomId: params.roomId,
      actorId: params.actorId,
      actorRole: membership.role,
      settings: room.appSettings,
      state,
      now: new Date().toISOString(),
    };
    // 7. Вызов модуля. AppRejection (ContractError) уходит наверх как есть —
    //    до коммита ничего не пишется.
    const commits = await mod.handlePublish(ctx, params.shortName, params.payload);
    for (const commit of commits) {
      const parsed = appCommitSchema.safeParse(commit);
      if (!parsed.success) {
        // Баг модуля, не клиента: наружу код, детали — в message (server-side).
        throw new ContractError('EVENT_PAYLOAD_INVALID', `module ${mod.appId} returned a malformed commit: ${parsed.error.message}`);
      }
    }
    // 8. Коммиты — через единственный путь записи, в одной транзакции, в порядке
    //    массива (seq возрастает — порядок модулем задан осознанно).
    if (commits.length > 0) {
      const committed = await this.outbox.run(async (tx) => {
        const out = [];
        for (const commit of commits) {
          out.push(
            await this.eventLog.commitAppEvent(
              tx,
              params.roomId,
              commit.shortName,
              commit.payload,
              commit.visibility,
              commit.actor === 'publisher' ? params.actorId : null,
            ),
          );
        }
        return out;
      });
      // 9. Тёплый fold: проекция продвигается закоммиченными событиями.
      this.foldCommitted(mod, params.roomId, state, committed);
    }
  }

  private async projectionFor(module: AppRuntimeModule, roomId: string): Promise<unknown> {
    const cached = this.projections.get(roomId);
    if (cached !== undefined) {
      return cached.state;
    }
    const events = await this.prisma.logEvent.findMany({
      where: { roomId, type: { startsWith: `${module.appId}.` } },
      orderBy: { seq: 'asc' },
    });
    let state = module.initialState();
    for (const event of events) {
      state = module.reduce(state, toAppLogEvent(module.appId, event));
    }
    this.projections.set(roomId, { state, lastSeq: events.at(-1)?.seq ?? 0 });
    return state;
  }

  private foldCommitted(
    module: AppRuntimeModule,
    roomId: string,
    state: unknown,
    committed: readonly { type: string; payload: unknown; actorId: string | null; seq: number; recordedAt: Date }[],
  ): void {
    let next = state;
    for (const event of committed) {
      next = module.reduce(next, toAppLogEvent(module.appId, event));
    }
    this.projections.set(roomId, { state: next, lastSeq: committed.at(-1)?.seq ?? 0 });
  }
}

function toAppLogEvent(
  appId: string,
  event: { type: string; payload: unknown; actorId: string | null; seq: number; recordedAt: Date },
): AppLogEvent {
  return {
    shortName: event.type.slice(appId.length + 1),
    payload: event.payload as Record<string, unknown>,
    actorId: event.actorId,
    seq: event.seq,
    recordedAt: event.recordedAt.toISOString(),
  };
}
