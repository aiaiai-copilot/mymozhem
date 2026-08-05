import { Inject, Logger } from '@nestjs/common';
import { OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  ContractError,
  publishRequestSchema,
  REALTIME_MESSAGES,
  resolveTypeOwner,
  subscribeRequestSchema,
  type ContractErrorCode,
  type ContractErrorPayload,
  type ProjectedEvent,
  type PublishOkAck,
  type PublishRequest,
  type RoomSnapshot,
  type SubscribeOkAck,
  type Visibility,
} from '@mymozhem/sdk';
import type { LogEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { TokenService, type AccessClaims } from '../auth/token.service';
import { MembershipService } from '../membership/membership.service';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { EventLogService } from './event-log.service';
import { EventOutbox } from './event-outbox';
import { ProjectionService, type OutwardLevel } from './projection.service';
import { RealtimeBus } from './realtime-bus';
import { RealtimeError } from './realtime.errors';
import { contractCodeFor } from './error-mapping';
import { SubscriptionRegistry } from './subscription-registry';
import { RECONNECT_RATE_LIMITER } from './realtime.tokens';

type Ack<T> = (result: T | ContractErrorPayload) => void;

// Socket.io-комнаты: общая (все члены) и organizer-канал (design §5). module-private
// канала не существует — уровень наружу не доставляется никогда (REQ-CORE-005).
const roomChannel = (roomId: string): string => `room:${roomId}`;
const organizerChannel = (roomId: string): string => `room:${roomId}:organizer`;

const claimsOf = (socket: Socket): AccessClaims => socket.data.claims as AccessClaims;

// Единственный Socket.io-код ядра (REQ-RT-006; boundary-правило socketio-only-in-realtime).
// Handshake = access JWT (REQ-RT-009: claims — единственный источник actorId).
// Наружу ровно {code} (REQ-SEC-006); причины — только в серверный лог.
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit<Server> {
  private readonly logger = new Logger(RealtimeGateway.name);
  private server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
    private readonly appRegistry: AppRegistryService,
    private readonly eventLog: EventLogService,
    private readonly outbox: EventOutbox,
    private readonly projection: ProjectionService,
    private readonly registry: SubscriptionRegistry,
    private readonly bus: RealtimeBus,
    @Inject(RECONNECT_RATE_LIMITER) private readonly reconnectLimiter: JoinRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  afterInit(server: Server): void {
    this.server = server;
    server.use((socket, next) => this.authenticate(socket, next));
    server.on('connection', (socket) => {
      socket.on(REALTIME_MESSAGES.SUBSCRIBE, (payload: unknown, ack: Ack<SubscribeOkAck>) =>
        void this.handleSubscribe(socket, payload, ack),
      );
      socket.on(REALTIME_MESSAGES.PUBLISH, (payload: unknown, ack: Ack<PublishOkAck>) =>
        void this.handlePublish(socket, payload, ack),
      );
      socket.on('disconnect', () => this.registry.remove(socket.id));
    });
    this.bus.subscribe((events) => this.fanOut(events));
  }

  // Handshake (design §4): отказы аутентификации — один SESSION_INVALID (причины не
  // различаются снаружи, как в refresh); потолок reconnect (REQ-RT-015, объём v1.3)
  // — RATE_LIMITED. Код уходит в message connect_error — он и есть wire-код.
  private authenticate(socket: Socket, next: (err?: Error) => void): void {
    let claims: AccessClaims;
    try {
      const token = (socket.handshake.auth as Record<string, unknown>).token;
      claims = this.tokens.verifyAccessToken(typeof token === 'string' ? token : '');
    } catch (err) {
      this.logger.warn(`socket auth failed: ${(err as Error).message}`);
      next(new Error('SESSION_INVALID'));
      return;
    }
    // Per-identity потолок на успешный handshake: каждый reconnect тянет replay —
    // точка учёта одна и самая ранняя после аутентификации; неаутентифицированные
    // попытки не считаются (identity ещё нет).
    if (!this.reconnectLimiter.tryAcquire(claims.sub)) {
      next(new Error('RATE_LIMITED'));
      return;
    }
    socket.data.claims = claims;
    next();
  }

  async handleSubscribe(socket: Socket, payload: unknown, ack: Ack<SubscribeOkAck>): Promise<void> {
    const parsed = subscribeRequestSchema.safeParse(payload);
    if (!parsed.success) {
      ack({ code: 'REQUEST_INVALID' });
      return;
    }
    // Error containment (санкционированный фикс, леджер Task 7 → Task 8): вызов идёт
    // через `void this.handleSubscribe(...)` — неожиданный throw (prisma, join) без
    // try/catch стал бы unhandled rejection и клиент остался бы без ack. Семантика
    // — та же, что у handlePublish: wireCodeOf, наружу ровно {code} (REQ-SEC-006).
    try {
      const claims = claimsOf(socket);
      const { roomId } = parsed.data;
      // REQ-ID-016: гостевой scope зашит в токен — GUEST подписывается только на свою
      // комнату; REGISTERED (токены — с OAuth-среза) решает membership-гейт.
      if (claims.kind === 'GUEST' && claims.roomId !== roomId) {
        ack({ code: 'ACTOR_NOT_MEMBER' });
        return;
      }
      // Мульти-подписка не строится (design §4): re-subscribe в ту же комнату —
      // идемпотентный повторный snapshot, в чужую — отказ.
      const existing = this.registry.get(socket.id);
      if (existing !== undefined && existing.roomId !== roomId) {
        ack({ code: 'REQUEST_INVALID' });
        return;
      }
      // REQ-SEC-003: чтение подресурсов комнаты — только членам.
      const membership = await this.membership.findActiveMembership(roomId, claims.sub);
      if (!membership) {
        ack({ code: 'ACTOR_NOT_MEMBER' });
        return;
      }
      // MODERATOR в MVP без прав сверх PARTICIPANT (amendment v1.3) → public.
      const level: OutwardLevel = membership.role === 'ORGANIZER' ? 'organizer' : 'public';
      const room = await this.prisma.room.findUnique({ where: { id: roomId } });
      const events = await this.prisma.logEvent.findMany({
        where: { roomId },
        orderBy: { seq: 'asc' },
      });
      const manifest =
        room?.appId != null && room.manifestVersion != null
          ? this.appRegistry.getManifest(room.appId, room.manifestVersion)
          : undefined;
      const snapshot: RoomSnapshot = {
        events: this.projection.projectEvents(events, level),
        appSettings: this.projection.projectAppSettings(room?.appSettings ?? null, manifest, level),
      };
      // Контракт вызывающего реестра (леджер Task 6): тот же socketId перезаписывает
      // только ту же (identityId, roomId) пару — re-add той же подписки идемпотентен;
      // подписка в чужую комнату отклонена выше (REQUEST_INVALID), поэтому расщепления
      // индексов не возникает.
      this.registry.add({ socketId: socket.id, identityId: claims.sub, roomId, level });
      await socket.join(roomChannel(roomId));
      if (level === 'organizer') await socket.join(organizerChannel(roomId));
      ack({ ok: true, snapshot });
    } catch (err) {
      ack({ code: this.wireCodeOf(err) });
    }
  }

  async handlePublish(socket: Socket, payload: unknown, ack: Ack<PublishOkAck>): Promise<void> {
    const parsed = publishRequestSchema.safeParse(payload);
    if (!parsed.success) {
      ack({ code: 'REQUEST_INVALID' });
      return;
    }
    // roomId — из подписки, actorId — из claims: из payload не берётся ничего,
    // кроме данных самого события (REQ-RT-009, design §5).
    const sub = this.registry.get(socket.id);
    if (sub === undefined) {
      ack({ code: 'ACTOR_NOT_MEMBER' });
      return;
    }
    try {
      // Владелец типа — из имени: core-пространство для клиента закрыто (lifecycle
      // эмитит только ядро); тип чужого app отсутствует в пиннутом манифесте —
      // отсекает шаг 4 commit-цепочки (EVENT_UNKNOWN_TYPE).
      const owner = resolveTypeOwner(parsed.data.type);
      if (owner.kind === 'core') {
        ack({ code: 'EVENT_UNKNOWN_TYPE' });
        return;
      }
      const visibility = await this.effectiveVisibility(sub.roomId, owner.appId, owner.shortName, parsed.data);
      await this.outbox.run((tx) =>
        this.eventLog.commitAppEvent(tx, sub.roomId, owner.shortName, parsed.data.payload, visibility, claimsOf(socket).sub),
      );
      ack({ ok: true });
    } catch (err) {
      ack({ code: this.wireCodeOf(err) });
    }
  }

  // §0.6: умолчание visibility — декларированный потолок типа. Неизвестному типу
  // дефолт безразличен (commit откажет EVENT_UNKNOWN_TYPE) — fail-safe module-private.
  private async effectiveVisibility(
    roomId: string,
    appId: string,
    shortName: string,
    request: PublishRequest,
  ): Promise<Visibility> {
    if (request.visibility !== undefined) return request.visibility;
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { manifestVersion: true },
    });
    const definition =
      room?.manifestVersion != null
        ? this.appRegistry.getEventDefinition(appId, room.manifestVersion, shortName)
        : undefined;
    return definition?.visibility ?? 'module-private';
  }

  // Live-доставка: проекцию строит ProjectionService — ручной фильтрации полей
  // здесь нет и быть не может (REQ-CORE-005).
  private fanOut(events: readonly LogEvent[]): void {
    for (const event of events) {
      // Изоляция per-event (санкционированное отклонение, леджер Task 5 → Task 7):
      // RealtimeBus.publish пропагирует исключения слушателя синхронно — throw
      // здесь отклонил бы outbox.run ПОСЛЕ успешного коммита. Падающая проекция/
      // эмит логируется и пропускается, остальные события доставляются.
      try {
        const projected: ProjectedEvent = this.projection.projectEvent(event);
        if (event.visibility === 'PUBLIC') {
          this.server.to(roomChannel(event.roomId)).emit(REALTIME_MESSAGES.EVENT, projected);
        } else if (event.visibility === 'ORGANIZER') {
          this.server.to(organizerChannel(event.roomId)).emit(REALTIME_MESSAGES.EVENT, projected);
        }
      } catch (err) {
        this.logger.error(
          `fan-out of ${event.type} (room ${event.roomId}, seq ${event.seq}) failed: ${(err as Error).message}`,
        );
      }
    }
  }

  // Hook среза исключения (design §4, §0.2): немедленный разрыв всех подписок
  // identity в комнате. Вызывающего пока нет — срез исключения ОБЯЗАН вызвать этот
  // метод (шов, зафиксирован в дизайне §9).
  revokeRoomAccess(identityId: string, roomId: string): void {
    for (const socketId of this.registry.socketsOf(identityId, roomId)) {
      const socket = this.server.sockets.sockets.get(socketId);
      this.registry.remove(socketId);
      if (socket !== undefined) {
        socket.leave(roomChannel(roomId));
        socket.leave(organizerChannel(roomId));
        socket.disconnect(true);
      }
    }
  }

  private wireCodeOf(err: unknown): ContractErrorCode {
    if (err instanceof RealtimeError) return contractCodeFor(err);
    if (err instanceof ContractError) return err.code;
    // REQ-SEC-006: неизвестное — INTERNAL_ERROR, детали только в серверный лог.
    this.logger.error(err);
    return 'INTERNAL_ERROR';
  }
}
