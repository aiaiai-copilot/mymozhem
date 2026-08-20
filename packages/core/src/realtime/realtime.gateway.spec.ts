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
    connected: true,
    disconnected: false as boolean | unknown,
    join(room: string) { this.joined.push(room); },
    leave(room: string) { this.left.push(room); },
    disconnect(close?: boolean) { this.disconnected = close ?? true; },
  };
}
type FakeSocket = ReturnType<typeof fakeSocket>;

type Ack = (value: unknown) => void;

function makeGateway(overrides: {
  membership?: { findActiveMembership: jest.Mock; onAccessRevoked?: jest.Mock };
  prisma?: { room: { findUnique: jest.Mock }; logEvent: { findMany: jest.Mock } };
  eventLog?: { commitAppEvent: jest.Mock };
  outbox?: { run: jest.Mock };
  registry?: SubscriptionRegistry;
  tokens?: { verifyAccessToken: jest.Mock };
  reconnectLimiter?: { tryAcquire: jest.Mock };
}) {
  const membership = overrides.membership ?? {
    findActiveMembership: jest.fn().mockResolvedValue({ role: 'PARTICIPANT' }),
    onAccessRevoked: jest.fn(),
  };
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

  // Санкционированный фикс (леджер Task 7 → Task 8): неожиданный throw внутри
  // handleSubscribe (prisma упала, join отклонился) не должен улетать unhandled
  // rejection'ом через `void this.handleSubscribe(...)` — клиент получает ack
  // ровно {code: 'INTERNAL_ERROR'}, детали только в серверный лог (REQ-SEC-006).
  it('unexpected infrastructure failure is contained: ack INTERNAL_ERROR, no throw escapes', async () => {
    const { gateway } = makeGateway({
      membership: { findActiveMembership: jest.fn().mockRejectedValue(new Error('prisma down')) },
    });
    const logger = { error: jest.fn(), warn: jest.fn() };
    (gateway as unknown as { logger: unknown }).logger = logger;
    const { ack, calls } = ackOf();
    await expect(
      gateway.handleSubscribe(fakeSocket() as never, { roomId: ROOM }, ack),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([{ code: 'INTERNAL_ERROR' }]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  // Join-first (design §4, final-review fix I-1): join теперь внутри try до чтения
  // лога — сбой join ПОСЛЕ registry.add обязан откатить полуподписку (реестр +
  // каналы), иначе клиент с ack-ошибкой продолжал бы получать live-поток.
  it('join failure after registry.add leaves no stale subscription', async () => {
    const registry = new SubscriptionRegistry();
    const { gateway } = makeGateway({ registry });
    const logger = { error: jest.fn(), warn: jest.fn() };
    (gateway as unknown as { logger: unknown }).logger = logger;
    const socket = fakeSocket();
    socket.join = () => {
      throw new Error('adapter down');
    };
    const { ack, calls } = ackOf();
    await expect(
      gateway.handleSubscribe(socket as never, { roomId: ROOM }, ack),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([{ code: 'INTERNAL_ERROR' }]);
    expect(registry.get('socket-1')).toBeUndefined();
    expect(socket.left).toEqual([`room:${ROOM}`, `room:${ROOM}:organizer`]);
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

  // M-3: disconnect внутри subscribe (между registry.add и ack) — слушатель disconnect
  // уже сделал remove no-op'ом; без проверки connected запись мёртвого сокета протухала
  // бы в реестре. Фикс: финальная проверка socket.connected до ack.
  it('disconnect mid-subscribe leaves no registry entry and sends no ack (M-3)', async () => {
    const registry = new SubscriptionRegistry();
    const { gateway } = makeGateway({ registry });
    const socket = fakeSocket();
    socket.connected = false; // disconnect прилетел, пока subscribe читал лог
    const { ack, calls } = ackOf();
    await gateway.handleSubscribe(socket as never, { roomId: ROOM }, ack);
    expect(registry.get(socket.id)).toBeUndefined();
    expect(calls).toEqual([]);
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

  // Санкционированное отклонение (леджер Task 5 → Task 7, решение владельца):
  // доставка изолирована per-event — падающая проекция/эмит логируется и
  // пропускается, исключение НЕ вырывается наружу (иначе throw внутри fanOut
  // отклонил бы outbox.run ПОСЛЕ успешного коммита).
  it('fanOut isolates per-event delivery: a throwing projection is logged and skipped, other events still delivered', () => {
    const { gateway, emitted } = gatewayWithServer();
    const logger = { error: jest.fn() };
    (gateway as unknown as { logger: unknown }).logger = logger;
    const spy = jest
      .spyOn(ProjectionService.prototype, 'projectEvent')
      .mockImplementationOnce(() => {
        throw new Error('boom');
      });
    try {
      expect(() =>
        (gateway as unknown as { fanOut(e: unknown[]): void }).fanOut([
          { ...EVENT_ROW, visibility: 'PUBLIC', type: 'quiz.boom.event' },
          { ...EVENT_ROW, visibility: 'PUBLIC' },
          { ...EVENT_ROW, visibility: 'ORGANIZER' },
        ]),
      ).not.toThrow();
      expect(emitted.map((e) => e.room)).toEqual([`room:${ROOM}`, `room:${ROOM}:organizer`]);
      expect(logger.error).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
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

  it('afterInit подписывает revokeRoomAccess на hook membership (REQ-SEC-003)', () => {
    const onAccessRevoked = jest.fn();
    const { gateway } = makeGateway({ membership: { findActiveMembership: jest.fn(), onAccessRevoked } });
    const use = jest.fn();
    const on = jest.fn();
    const server = { use, on, sockets: { sockets: new Map() } };
    // bus.subscribe — фейк в makeGateway: { subscribe: jest.fn(), publish: jest.fn() }
    gateway.afterInit(server as never);
    expect(onAccessRevoked).toHaveBeenCalledTimes(1);
    expect(onAccessRevoked.mock.calls[0][0]).toBeInstanceOf(Function);
  });
});
