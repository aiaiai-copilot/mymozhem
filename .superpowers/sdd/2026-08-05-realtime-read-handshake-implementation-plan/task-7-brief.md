### Task 7: RealtimeGateway + ConfigurableIoAdapter + wiring

**Files:**
- Modify: `packages/core/package.json` (deps: `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`)
- Create: `packages/core/src/realtime/realtime.gateway.ts`
- Create: `packages/core/src/realtime/realtime.gateway.spec.ts`
- Create: `packages/core/src/realtime/io-adapter.ts`
- Modify: `packages/core/src/realtime/realtime.module.ts` (gateway, registry, projection, лимитер, импорты Auth/Membership)
- Modify: `packages/core/src/index.ts` (экспорты gateway/adapter/registry/projection/tokens)
- Modify: `apps/server/src/main.ts` (useWebSocketAdapter)

**Interfaces:**
- Consumes: всё из Tasks 1-6 (`ProjectionService`, `SubscriptionRegistry`, `EventOutbox`, `RealtimeBus`, `contractCodeFor`, `RECONNECT_RATE_LIMITER`, `findActiveMembership`, SDK Task 2).
- Produces (Task 8): работающий Socket.io endpoint на том же HTTP-сервере; `RealtimeGateway` с `handleSubscribe(socket, payload, ack)`, `handlePublish(socket, payload, ack)`, `revokeRoomAccess(identityId: string, roomId: string): void`; `ConfigurableIoAdapter` (конструктор `(config: AppConfig)`), экспортированный из barrel для `main.ts` и e2e.

- [ ] **Step 1: Зависимости**

```bash
pnpm --filter @mymozhem/core add socket.io@^4.8.1 @nestjs/websockets@^11.0.0 @nestjs/platform-socket.io@^11.0.0
pnpm install
```

Проверка: `pnpm --filter @mymozhem/core exec node -e "require('socket.io/package.json')" ` не падает. Boundary-правило `socketio-only-in-realtime` уже разрешает импорт из `packages/core/src/realtime`.

- [ ] **Step 2: Failing unit test — gateway на фейках**

`packages/core/src/realtime/realtime.gateway.spec.ts`. Gateway тестируется без socket.io: методы публичные, socket — структурный фейк (прецедент ReplyLike в http-exception.filter).

```ts
import type { AccessClaims } from '../auth/token.service';
import { RealtimeGateway } from './realtime.gateway';
import { SubscriptionRegistry } from './subscription-registry';
import { ProjectionService } from './projection.service';
import { REALTIME_MESSAGES } from '@mymozhem/sdk';

const GUEST_CLAIMS: AccessClaims = {
  sub: '22222222-2222-4222-8222-222222222222',
  sid: '33333333-3333-4333-8333-333333333333',
  kind: 'GUEST',
  roomId: '11111111-1111-4111-8111-111111111111',
};
const ROOM = GUEST_CLAIMS.roomId as string;

function fakeSocket(claims: AccessClaims = GUEST_CLAIMS) {
  return {
    id: 'socket-1',
    data: { claims },
    handshake: { auth: { token: 'x' } },
    joined: [] as string[],
    left: [] as string[],
    disconnected: false as boolean | unknown,
    join(room: string) { this.joined.push(room); },
    leave(room: string) { this.left.push(room); },
    disconnect(close?: boolean) { this.disconnected = close ?? true; },
  };
}
type FakeSocket = ReturnType<typeof fakeSocket>;

type Ack = (value: unknown) => void;

function makeGateway(overrides: {
  membership?: { findActiveMembership: jest.Mock };
  prisma?: { room: { findUnique: jest.Mock }; logEvent: { findMany: jest.Mock } };
  eventLog?: { commitAppEvent: jest.Mock };
  outbox?: { run: jest.Mock };
  registry?: SubscriptionRegistry;
  tokens?: { verifyAccessToken: jest.Mock };
  reconnectLimiter?: { tryAcquire: jest.Mock };
}) {
  const membership = overrides.membership ?? { findActiveMembership: jest.fn().mockResolvedValue({ role: 'PARTICIPANT' }) };
  const prisma = overrides.prisma ?? {
    room: { findUnique: jest.fn().mockResolvedValue({ appId: 'quiz', manifestVersion: 1, appSettings: null }) },
    logEvent: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const eventLog = overrides.eventLog ?? { commitAppEvent: jest.fn().mockResolvedValue({}) };
  const outbox = overrides.outbox ?? { run: jest.fn((fn: (tx: unknown) => unknown) => fn('tx')) };
  const tokens = overrides.tokens ?? { verifyAccessToken: jest.fn().mockReturnValue(GUEST_CLAIMS) };
  const reconnectLimiter = overrides.reconnectLimiter ?? { tryAcquire: jest.fn().mockReturnValue(true) };
  const gateway = new RealtimeGateway(
    tokens as never,
    prisma as never,
    membership as never,
    { getManifest: jest.fn().mockReturnValue(undefined), getEventDefinition: jest.fn().mockReturnValue(undefined) } as never,
    eventLog as never,
    outbox as never,
    new ProjectionService(),
    overrides.registry ?? new SubscriptionRegistry(),
    { subscribe: jest.fn(), publish: jest.fn() } as never,
    reconnectLimiter as never,
    {} as never,
  );
  return { gateway, membership, prisma, eventLog, outbox, tokens, reconnectLimiter };
}

const ackOf = () => {
  const calls: unknown[] = [];
  const ack: Ack = (v) => calls.push(v);
  return { ack, calls };
};

describe('RealtimeGateway.handleSubscribe', () => {
  it('rejects malformed payloads with REQUEST_INVALID', async () => {
    const { gateway } = makeGateway({});
    const { ack, calls } = ackOf();
    await gateway.handleSubscribe(fakeSocket() as never, { roomId: 'nope' }, ack);
    expect(calls).toEqual([{ code: 'REQUEST_INVALID' }]);
  });

  it('guest cannot subscribe to a room outside the token scope (REQ-ID-016)', async () => {
    const { gateway } = makeGateway({});
    const { ack, calls } = ackOf();
    await gateway.handleSubscribe(fakeSocket() as never, { roomId: '99999999-9999-4999-8999-999999999999' }, ack);
    expect(calls).toEqual([{ code: 'ACTOR_NOT_MEMBER' }]);
  });

  it('non-member gets ACTOR_NOT_MEMBER (REQ-SEC-003)', async () => {
    const { gateway } = makeGateway({ membership: { findActiveMembership: jest.fn().mockResolvedValue(null) } });
    const { ack, calls } = ackOf();
    await gateway.handleSubscribe(fakeSocket() as never, { roomId: ROOM }, ack);
    expect(calls).toEqual([{ code: 'ACTOR_NOT_MEMBER' }]);
  });

  it('participant joins the room channel with a public snapshot', async () => {
    const registry = new SubscriptionRegistry();
    const { gateway } = makeGateway({ registry });
    const socket = fakeSocket();
    const { ack, calls } = ackOf();
    await gateway.handleSubscribe(socket as never, { roomId: ROOM }, ack);
    expect(socket.joined).toEqual([`room:${ROOM}`]);
    expect(calls).toEqual([{ ok: true, snapshot: { events: [], appSettings: {} } }]);
    expect(registry.get('socket-1')).toMatchObject({ identityId: GUEST_CLAIMS.sub, roomId: ROOM, level: 'public' });
  });

  it('organizer joins both channels at organizer level', async () => {
    const { gateway } = makeGateway({ membership: { findActiveMembership: jest.fn().mockResolvedValue({ role: 'ORGANIZER' }) } });
    const socket = fakeSocket();
    const { ack, calls } = ackOf();
    await gateway.handleSubscribe(socket as never, { roomId: ROOM }, ack);
    expect(socket.joined).toEqual([`room:${ROOM}`, `room:${ROOM}:organizer`]);
    expect(calls).toEqual([{ ok: true, snapshot: { events: [], appSettings: {} } }]);
  });

  it('second subscription of the same socket to another room is REQUEST_INVALID', async () => {
    const registry = new SubscriptionRegistry();
    registry.add({ socketId: 'socket-1', identityId: GUEST_CLAIMS.sub, roomId: ROOM, level: 'public' });
    const { gateway } = makeGateway({ registry });
    const { ack, calls } = ackOf();
    await gateway.handleSubscribe(fakeSocket() as never, { roomId: ROOM }, ack); // re-subscribe в ту же — ок
    expect(calls[0]).toMatchObject({ ok: true });
    const claims2 = { ...GUEST_CLAIMS, roomId: ROOM };
    void claims2;
    // чужая комната для того же сокета:
    const other = fakeSocket({ ...GUEST_CLAIMS, roomId: '99999999-9999-4999-8999-999999999999' });
    const { ack: ack2, calls: calls2 } = ackOf();
    await gateway.handleSubscribe(other as never, { roomId: '99999999-9999-4999-8999-999999999999' }, ack2);
    expect(calls2).toEqual([{ code: 'REQUEST_INVALID' }]);
  });
});

describe('RealtimeGateway.handlePublish', () => {
  const SUBSCRIBED_ROOM = ROOM;

  function subscribedGateway(overrides: Parameters<typeof makeGateway>[0] = {}) {
    const registry = new SubscriptionRegistry();
    registry.add({ socketId: 'socket-1', identityId: GUEST_CLAIMS.sub, roomId: SUBSCRIBED_ROOM, level: 'public' });
    return makeGateway({ ...overrides, registry });
  }

  it('rejects malformed payloads with REQUEST_INVALID', async () => {
    const { gateway } = subscribedGateway();
    const { ack, calls } = ackOf();
    await gateway.handlePublish(fakeSocket() as never, { type: 'bad', payload: {} }, ack);
    expect(calls).toEqual([{ code: 'REQUEST_INVALID' }]);
  });

  it('unsubscribed socket gets ACTOR_NOT_MEMBER', async () => {
    const { gateway } = makeGateway({});
    const { ack, calls } = ackOf();
    await gateway.handlePublish(fakeSocket() as never, { type: 'quiz.answer.submitted', payload: {} }, ack);
    expect(calls).toEqual([{ code: 'ACTOR_NOT_MEMBER' }]);
  });

  it('core namespace is closed for clients (EVENT_UNKNOWN_TYPE)', async () => {
    const { gateway } = subscribedGateway();
    const { ack, calls } = ackOf();
    await gateway.handlePublish(fakeSocket() as never, { type: 'core.room.completed', payload: {} }, ack);
    expect(calls).toEqual([{ code: 'EVENT_UNKNOWN_TYPE' }]);
  });

  it('maps commit-chain errors via the mapping table (REQ-SEC-006)', async () => {
    const { RoomNotActiveError } = await import('./realtime.errors');
    const outbox = { run: jest.fn().mockRejectedValue(new RoomNotActiveError('sealed')) };
    const { gateway } = subscribedGateway({ outbox });
    const { ack, calls } = ackOf();
    await gateway.handlePublish(fakeSocket() as never, { type: 'quiz.answer.submitted', payload: { c: 1 } }, ack);
    expect(calls).toEqual([{ code: 'ROOM_LOG_SEALED' }]);
  });

  it('commits with actorId from claims, roomId from the subscription (REQ-RT-009)', async () => {
    const eventLog = { commitAppEvent: jest.fn().mockResolvedValue({}) };
    const outbox = { run: jest.fn((fn: (tx: unknown) => unknown) => fn('tx')) };
    const { gateway } = subscribedGateway({ eventLog, outbox });
    const { ack, calls } = ackOf();
    await gateway.handlePublish(fakeSocket() as never, { type: 'quiz.answer.submitted', payload: { c: 1 }, visibility: 'public' }, ack);
    expect(calls).toEqual([{ ok: true }]);
    expect(eventLog.commitAppEvent).toHaveBeenCalledWith(
      'tx', SUBSCRIBED_ROOM, 'answer.submitted', { c: 1 }, 'public', GUEST_CLAIMS.sub,
    );
  });

  it('defaults visibility to the type ceiling when omitted (design §0.6)', async () => {
    const eventLog = { commitAppEvent: jest.fn().mockResolvedValue({}) };
    const outbox = { run: jest.fn((fn: (tx: unknown) => unknown) => fn('tx')) };
    const appRegistry = {
      getManifest: jest.fn(),
      getEventDefinition: jest.fn().mockReturnValue({ visibility: 'organizer', schema: {}, version: 1 }),
    };
    const registry = new SubscriptionRegistry();
    registry.add({ socketId: 'socket-1', identityId: GUEST_CLAIMS.sub, roomId: SUBSCRIBED_ROOM, level: 'public' });
    const gateway = new RealtimeGateway(
      { verifyAccessToken: jest.fn() } as never,
      { room: { findUnique: jest.fn().mockResolvedValue({ manifestVersion: 1 }) }, logEvent: { findMany: jest.fn() } } as never,
      { findActiveMembership: jest.fn() } as never,
      appRegistry as never,
      eventLog as never,
      outbox as never,
      new ProjectionService(),
      registry,
      { subscribe: jest.fn(), publish: jest.fn() } as never,
      { tryAcquire: jest.fn() } as never,
      {} as never,
    );
    const { ack } = ackOf();
    await gateway.handlePublish(fakeSocket() as never, { type: 'quiz.answer.submitted', payload: { c: 1 } }, ack);
    expect(eventLog.commitAppEvent).toHaveBeenCalledWith(
      'tx', SUBSCRIBED_ROOM, 'answer.submitted', { c: 1 }, 'organizer', GUEST_CLAIMS.sub,
    );
  });
});

describe('RealtimeGateway fan-out and revoke', () => {
  function gatewayWithServer() {
    const emitted: { room: string; event: string; payload: unknown }[] = [];
    const sockets = new Map<string, FakeSocket>();
    const server = {
      sockets: { sockets },
      to(room: string) {
        return { emit: (event: string, payload: unknown) => emitted.push({ room, event, payload }) };
      },
    };
    const registry = new SubscriptionRegistry();
    const { gateway } = makeGateway({ registry });
    (gateway as unknown as { server: unknown }).server = server;
    return { gateway, emitted, sockets, registry };
  }

  const EVENT_ROW = {
    roomId: ROOM,
    seq: 5,
    type: 'quiz.answer.submitted',
    payload: { c: 1 },
    actorId: GUEST_CLAIMS.sub,
    schemaVersion: 1,
    recordedAt: new Date(),
  };

  it('fanOut delivers public events to the room, organizer to the organizer channel, module-private nowhere (REQ-CORE-005)', () => {
    const { gateway, emitted } = gatewayWithServer();
    (gateway as unknown as { fanOut(e: unknown[]): void }).fanOut([
      { ...EVENT_ROW, visibility: 'PUBLIC' },
      { ...EVENT_ROW, visibility: 'ORGANIZER' },
      { ...EVENT_ROW, visibility: 'MODULE_PRIVATE' },
    ]);
    expect(emitted.map((e) => e.room)).toEqual([`room:${ROOM}`, `room:${ROOM}:organizer`]);
    expect(emitted[0].event).toBe(REALTIME_MESSAGES.EVENT);
    expect(emitted[0].payload).toEqual({ type: 'quiz.answer.submitted', payload: { c: 1 }, actorId: GUEST_CLAIMS.sub });
  });

  it('revokeRoomAccess disconnects every socket of the identity in the room (REQ-SEC-003 hook)', () => {
    const { gateway, sockets, registry } = gatewayWithServer();
    const s1 = fakeSocket();
    const s2 = { ...fakeSocket(), id: 'socket-2' };
    sockets.set('socket-1', s1);
    sockets.set('socket-2', s2);
    registry.add({ socketId: 'socket-1', identityId: GUEST_CLAIMS.sub, roomId: ROOM, level: 'public' });
    registry.add({ socketId: 'socket-2', identityId: GUEST_CLAIMS.sub, roomId: ROOM, level: 'public' });
    gateway.revokeRoomAccess(GUEST_CLAIMS.sub, ROOM);
    expect(s1.disconnected).toBe(true);
    expect(s2.disconnected).toBe(true);
    expect(registry.socketsOf(GUEST_CLAIMS.sub, ROOM)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core test realtime.gateway`
Expected: FAIL — `./realtime.gateway` не существует.

- [ ] **Step 4: Implementation — gateway**

`packages/core/src/realtime/realtime.gateway.ts`:

```ts
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
    this.registry.add({ socketId: socket.id, identityId: claims.sub, roomId, level });
    await socket.join(roomChannel(roomId));
    if (level === 'organizer') await socket.join(organizerChannel(roomId));
    ack({ ok: true, snapshot });
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
      const projected: ProjectedEvent = this.projection.projectEvent(event);
      if (event.visibility === 'PUBLIC') {
        this.server.to(roomChannel(event.roomId)).emit(REALTIME_MESSAGES.EVENT, projected);
      } else if (event.visibility === 'ORGANIZER') {
        this.server.to(organizerChannel(event.roomId)).emit(REALTIME_MESSAGES.EVENT, projected);
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
```

(Примечание для имплементера: `this.config` в gateway на текущем объёме не читается — CORS живёт в IoAdapter, лимит запечатан в фабрике. Если lint ругнётся на unused private — убрать параметр `config` и `@Inject(APP_CONFIG)` импорт, а не глушить правило.)

- [ ] **Step 5: IoAdapter**

`packages/core/src/realtime/io-adapter.ts`:

```ts
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { AppConfig } from '../config/config.schema';

// CORS сокета повторяет HTTP-политику из того же конфига (design §8); wildcard в
// production запрещён superRefine конфиг-схемы (REQ-SEC-008). Подключается в
// apps/server main.ts и в e2e-boot (там своя копия boot-последовательности).
export class ConfigurableIoAdapter extends IoAdapter {
  constructor(private readonly config: AppConfig) {
    super();
  }

  override createIOServer(port: number, options?: Record<string, unknown>): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.config.CORS_ORIGINS },
    });
  }
}
```

(Если компилятор не согласится с сужением типов override — выровнять сигнатуру по фактической из `@nestjs/platform-socket.io` и зафиксировать отклонение в леджере.)

- [ ] **Step 6: Module wiring + barrel + main.ts**

`packages/core/src/realtime/realtime.module.ts` целиком:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { AuthModule } from '../auth/auth.module';
import { MembershipModule } from '../membership/membership.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { EventLogService } from './event-log.service';
import { EventEmitLimiter } from './event-emit-limiter';
import { RealtimeBus } from './realtime-bus';
import { EventOutbox } from './event-outbox';
import { ProjectionService } from './projection.service';
import { SubscriptionRegistry } from './subscription-registry';
import { RealtimeGateway } from './realtime.gateway';
import { RECONNECT_RATE_LIMITER } from './realtime.tokens';

// PrismaModule нужен EventOutbox'у (runner владеет транзакцией); сам примитив
// записи по-прежнему работает на транзакционном клиенте вызывающего — атомарность
// «действие + лог» (REQ-DEV-008) не меняется. Единственный модуль ядра, импортирующий
// socket.io (REQ-RT-006 + boundary-правило).
@Module({
  imports: [ConfigModule, AppRegistryModule, PrismaModule, AuthModule, MembershipModule],
  providers: [
    {
      provide: EventEmitLimiter,
      useFactory: (config: AppConfig) => new EventEmitLimiter(config.EVENT_EMIT_RATE_LIMIT_PER_MIN),
      inject: [APP_CONFIG],
    },
    {
      // REQ-RT-015 (объём v1.3): отдельный инстанс — состояние не делится с
      // join/refresh лимитерами; бэкофф/режимы — ф.4.
      provide: RECONNECT_RATE_LIMITER,
      useFactory: (config: AppConfig) => new JoinRateLimiter(config.RECONNECT_RATE_LIMIT_PER_MIN),
      inject: [APP_CONFIG],
    },
    RealtimeBus,
    EventOutbox,
    EventLogService,
    ProjectionService,
    SubscriptionRegistry,
    RealtimeGateway,
  ],
  exports: [EventLogService, EventOutbox],
})
export class RealtimeModule {}
```

В `packages/core/src/index.ts` после строки `export * from './realtime/event-outbox';` добавить:

```ts
export * from './realtime/projection.service';
export * from './realtime/subscription-registry';
export * from './realtime/realtime.tokens';
export * from './realtime/error-mapping';
export * from './realtime/io-adapter';
export * from './realtime/realtime.gateway';
```

В `apps/server/src/main.ts` — импорт `ConfigurableIoAdapter` из `@mymozhem/core` и строка до `app.listen`:

```ts
  // Socket.io на том же HTTP-сервере; CORS — из того же конфига (design §8).
  app.useWebSocketAdapter(new ConfigurableIoAdapter(config));
```

- [ ] **Step 7: Run unit test + build**

Run: `pnpm --filter @mymozhem/core test realtime.gateway`
Expected: PASS (13 тестов).
Run: `pnpm build && pnpm --filter @mymozhem/core test && pnpm lint && pnpm typecheck`
Expected: всё зелёное (включая существующие спеки).

- [ ] **Step 8: Commit**

```bash
git add packages/core apps/server/src/main.ts pnpm-lock.yaml
git commit -m "feat(core): RealtimeGateway (handshake/subscribe/publish/fan-out/revoke-hook) + ConfigurableIoAdapter (REQ-RT-006/009, REQ-SEC-003/006)"
```

---

