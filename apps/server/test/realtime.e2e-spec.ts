import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';
import { tokenResponseSchema, REALTIME_MESSAGES, type AppManifest, type AppRuntimeModule } from '@mymozhem/sdk';
import {
  APP_MANIFESTS,
  APP_RUNTIME_MODULES,
  AppRegistryService,
  ConfigurableIoAdapter,
  EventEmitLimiter,
  EventLogService,
  EventOutbox,
  IdentityService,
  JoinRateLimiter,
  MembershipService,
  RealtimeBus,
  RealtimeGateway,
  RoomService,
  TEST_CONFIG,
  TokenService,
  loadConfig,
  seedIdentity,
  startTestDb,
  type TestDb,
} from '@mymozhem/core';
import { AppModule } from '../src/app.module';

jest.setTimeout(180_000);

// RFC 9562-валидный v4 UUID: z.uuid() (zod v4) отклоняет версию 0, поэтому
// «нулевой» литерал из brief заменён — иначе проекция core.room.activated
// (actorId = ORG) падает на parse и subscribe отвечает INTERNAL_ERROR.
const ORG = '00000000-0000-4000-8000-000000000001';

// Манифест с типами всех трёх уровней (design §7): answer — public, round — organizer,
// secret — module-private.
const TEST_APP: AppManifest = {
  appId: 'test-app',
  manifestVersion: 1,
  contractRange: '^1.0.0',
  appSettings: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      label: { type: 'string', 'x-visibility': 'public' },
      orgNote: { type: 'string', 'x-visibility': 'organizer' },
      answers: { type: 'object' }, // без аннотации → module-private (fail-safe)
    },
  },
  events: {
    'note.posted': {
      schema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
      visibility: 'public',
      clientInitiated: true,
    },
    'round.hinted': {
      schema: { type: 'object', properties: { hint: { type: 'string' } }, required: ['hint'] },
      visibility: 'organizer',
      clientInitiated: true,
    },
    'secret.recorded': {
      schema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
      visibility: 'module-private',
      clientInitiated: true,
    },
  },
};

// Passthrough-модуль фазы-1 семантики (design 2026-09-09 §7): коммитит клиентский
// вход как есть, visibility — декларированный потолок типа.
const TEST_APP_MODULE: AppRuntimeModule = {
  appId: TEST_APP.appId,
  manifestVersion: TEST_APP.manifestVersion,
  manifest: TEST_APP,
  initialState: () => ({}),
  reduce: (state) => state,
  handlePublish: (_ctx, shortName, payload) => [
    { shortName, payload, visibility: TEST_APP.events[shortName]!.visibility, actor: 'publisher' as const },
  ],
};

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

// Boot зеркалит main.ts + websocket-адаптер (transport e2e прецедент); APP_MANIFESTS
// подменён фикстурным манифестом — в фазе 1 провайдер пуст (design §5 шов).
async function createApp(envOverrides: Record<string, string> = {}): Promise<NestFastifyApplication> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    const config = loadConfig(process.env);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_MANIFESTS)
      .useValue([TEST_APP])
      .overrideProvider(APP_RUNTIME_MODULES)
      .useValue([TEST_APP_MODULE])
      .compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie);
    await app.register(fastifyHelmet);
    await app.register(fastifyCors, { origin: config.CORS_ORIGINS });
    app.useWebSocketAdapter(new ConfigurableIoAdapter(config, app.getHttpAdapter().getHttpServer()));
    await app.init();
    await app.listen(0, '127.0.0.1');
    return app;
  } finally {
    for (const key of Object.keys(envOverrides)) restoreEnv(key, saved[key]);
  }
}

function portOf(app: NestFastifyApplication): number {
  const address = app.getHttpAdapter().getInstance().server.address();
  if (address === null || typeof address === 'string') throw new Error('no listening address');
  return address.port;
}

function connect(port: number, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = clientIo(`http://127.0.0.1:${port}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => {
      socket.close();
      reject(err);
    });
  });
}

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, (res: T) => resolve(res)));
}

function waitEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, (data: T) => resolve(data)));
}

// 4xx-отказ handshake: connect_error.message — wire-код (design §4).
function connectError(port: number, token: string): Promise<string> {
  return connect(port, token).then(
    (socket) => {
      socket.close();
      throw new Error('connected unexpectedly');
    },
    (err: Error) => err.message,
  );
}

describe('Realtime (e2e)', () => {
  let db: TestDb;
  let roomService: RoomService;
  let tokens: TokenService;
  let app: NestFastifyApplication;
  let port: number;
  let savedDatabaseUrl: string | undefined;
  let savedJwtSecret: string | undefined;

  beforeAll(async () => {
    savedDatabaseUrl = process.env.DATABASE_URL;
    savedJwtSecret = process.env.JWT_SECRET;
    db = await startTestDb();
    process.env.JWT_SECRET = TEST_CONFIG.JWT_SECRET;
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    const bus = new RealtimeBus();
    const outbox = new EventOutbox(db.prisma, bus);
    const registry = new AppRegistryService([TEST_APP]);
    const eventLog = new EventLogService(registry, new EventEmitLimiter(1000), TEST_CONFIG, outbox);
    roomService = new RoomService(
      db.prisma,
      eventLog,
      outbox,
      registry,
      new MembershipService(db.prisma, new IdentityService(db.prisma), new JoinRateLimiter(1000), TEST_CONFIG),
      TEST_CONFIG,
    );
    tokens = new TokenService(db.prisma, TEST_CONFIG);
    app = await createApp();
    port = portOf(app);
  });

  afterAll(async () => {
    await app.close();
    await db.stop();
    restoreEnv('DATABASE_URL', savedDatabaseUrl);
    restoreEnv('JWT_SECRET', savedJwtSecret);
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE identity."Session", membership."Membership", room."Room" CASCADE',
    );
  });

  // Активная комната с пином TEST_APP + guest join по HTTP → access token участника.
  async function activeRoomWithGuest() {
    const room = await roomService.create(ORG);
    await roomService.configure(room.id, {
      appId: 'test-app',
      manifestVersion: 1,
      settings: { label: 'live', orgNote: 'o', answers: { r1: 2 } },
    });
    await roomService.activate(room.id, ORG);
    const res = await app.inject({
      method: 'POST',
      url: '/rooms/join',
      payload: { code: room.code, displayName: 'Гостя' },
    });
    expect(res.statusCode).toBe(201);
    const { accessToken } = tokenResponseSchema.parse(res.json());
    return { room, accessToken };
  }

  async function organizerToken(roomId: string): Promise<string> {
    const issued = await tokens.issueGuestTokens(ORG, roomId);
    return issued.accessToken;
  }

  it('late-join replay: snapshot несёт видимую проекцию без seq/visibility/cursor (критерий ф.1, REQ-RT-003/011a)', async () => {
    const { room, accessToken } = await activeRoomWithGuest();
    const socket = await connect(port, accessToken);
    const ack = await emitAck<{ ok: true; snapshot: { events: Record<string, unknown>[]; appSettings: Record<string, unknown> } }>(
      socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id },
    );
    expect(ack.ok).toBe(true);
    expect(ack.snapshot.events.map((e) => e.type)).toEqual(['core.room.activated']);
    for (const e of ack.snapshot.events) {
      expect(Object.keys(e).sort()).toEqual(['actorId', 'payload', 'type']);
    }
    // appSettings: label — public (виден), answers — module-private (fail-safe, скрыт).
    expect(ack.snapshot.appSettings).toEqual({ label: 'live' });
    socket.close();
  });

  it('publish → commit → live-доставка второму подписчику; actorId из токена (REQ-RT-009)', async () => {
    const { room, accessToken } = await activeRoomWithGuest();
    const pub = await connect(port, accessToken);
    const sub = await connect(port, accessToken);
    await emitAck(pub, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    await emitAck(sub, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });

    const received = waitEvent<{ type: string; payload: unknown; actorId: string | null }>(sub, REALTIME_MESSAGES.EVENT);
    const ack = await emitAck<{ ok: true }>(pub, REALTIME_MESSAGES.PUBLISH, {
      type: 'test-app.note.posted',
      payload: { n: 1, actorId: 'spoofed' }, // actorId в payload игнорируется
    });
    expect(ack.ok).toBe(true);
    const event = await received;
    expect(event.type).toBe('test-app.note.posted');
    expect(event.payload).toEqual({ n: 1, actorId: 'spoofed' }); // payload — данные приложения как есть
    const claims = tokens.verifyAccessToken(accessToken);
    expect(event.actorId).toBe(claims.sub); // actorId конверта — только из токена
    pub.close();
    sub.close();
  });

  it('publish в запечатанную комнату → ROOM_LOG_SEALED (REQ-RT-016 через провод)', async () => {
    const { room, accessToken } = await activeRoomWithGuest();
    const socket = await connect(port, accessToken);
    await emitAck(socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    await roomService.complete(room.id, ORG);
    const ack = await emitAck(socket, REALTIME_MESSAGES.PUBLISH, {
      type: 'test-app.note.posted',
      payload: { n: 1 },
    });
    expect(ack).toEqual({ code: 'ROOM_LOG_SEALED' });
    socket.close();
  });

  it('видимость live: organizer-уровень — только организатору, module-private — никому (REQ-CORE-005, критерий ф.1)', async () => {
    const { room, accessToken } = await activeRoomWithGuest();
    const organizer = await connect(port, await organizerToken(room.id));
    const participant = await connect(port, accessToken);
    await emitAck(organizer, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    await emitAck(participant, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });

    const organizerEvents: { type: string }[] = [];
    const participantEvents: { type: string }[] = [];
    organizer.on(REALTIME_MESSAGES.EVENT, (e: { type: string }) => organizerEvents.push(e));
    participant.on(REALTIME_MESSAGES.EVENT, (e: { type: string }) => participantEvents.push(e));

    const pub = await connect(port, accessToken);
    await emitAck(pub, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    await emitAck(pub, REALTIME_MESSAGES.PUBLISH, { type: 'test-app.note.posted', payload: { n: 1 } });
    await emitAck(pub, REALTIME_MESSAGES.PUBLISH, { type: 'test-app.round.hinted', payload: { hint: 'h' } });
    await emitAck(pub, REALTIME_MESSAGES.PUBLISH, { type: 'test-app.secret.recorded', payload: { n: 9 } });
    // Доставка асинхронна: ждём public-событие у участника как маркер flush.
    await new Promise<void>((resolve) => {
      participant.once(REALTIME_MESSAGES.EVENT, () => resolve());
      void emitAck(pub, REALTIME_MESSAGES.PUBLISH, { type: 'test-app.note.posted', payload: { n: 2 } });
    });

    expect(participantEvents.map((e) => e.type)).toEqual(['test-app.note.posted', 'test-app.note.posted']);
    expect(organizerEvents.map((e) => e.type)).toEqual([
      'test-app.note.posted',
      'test-app.round.hinted',
      'test-app.note.posted',
    ]);
    organizer.close();
    participant.close();
    pub.close();
  });

  it('replay-видимость: snapshot участника — только public, организатора — public+organizer, module-private никому (REQ-CORE-005/008)', async () => {
    const { room, accessToken } = await activeRoomWithGuest();
    // Пре-коммит ДО подключения подписчиков: organizer- и module-private события
    // уже в логе — replay обязан построить видимость по уровню запрашивающего.
    const pub = await connect(port, accessToken);
    await emitAck(pub, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    await emitAck(pub, REALTIME_MESSAGES.PUBLISH, { type: 'test-app.round.hinted', payload: { hint: 'h' } });
    await emitAck(pub, REALTIME_MESSAGES.PUBLISH, { type: 'test-app.secret.recorded', payload: { n: 9 } });
    pub.close();

    const participant = await connect(port, accessToken);
    const organizer = await connect(port, await organizerToken(room.id));
    type Snap = { ok: true; snapshot: { events: { type: string }[]; appSettings: Record<string, unknown> } };
    const pAck = await emitAck<Snap>(participant, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    const oAck = await emitAck<Snap>(organizer, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });

    expect(pAck.snapshot.events.map((e) => e.type)).toEqual(['core.room.activated']);
    expect(oAck.snapshot.events.map((e) => e.type)).toEqual(['core.room.activated', 'test-app.round.hinted']);
    // appSettings: label — public (обоим), orgNote — organizer (только организатору),
    // answers — module-private (никому; fail-safe на неаннотированное свойство).
    expect(pAck.snapshot.appSettings).toEqual({ label: 'live' });
    expect(oAck.snapshot.appSettings).toEqual({ label: 'live', orgNote: 'o' });
    participant.close();
    organizer.close();
  });

  it('гость не подписывается на чужую комнату (scope REQ-ID-016)', async () => {
    const { accessToken } = await activeRoomWithGuest();
    const other = await roomService.create(ORG);
    const socket = await connect(port, accessToken);
    const ack = await emitAck(socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId: other.id });
    expect(ack).toEqual({ code: 'ACTOR_NOT_MEMBER' });
    socket.close();
  });

  it('handshake без валидного токена → SESSION_INVALID', async () => {
    expect(await connectError(port, 'not-a-token')).toBe('SESSION_INVALID');
  });

  it('reconnect-потолок: превышение → RATE_LIMITED (REQ-RT-015, объём v1.3)', async () => {
    const limitedApp = await createApp({ RECONNECT_RATE_LIMIT_PER_MIN: '2' });
    const limitedPort = portOf(limitedApp);
    try {
      const { accessToken } = await activeRoomWithGuest();
      const s1 = await connect(limitedPort, accessToken);
      s1.close();
      const s2 = await connect(limitedPort, accessToken);
      s2.close();
      expect(await connectError(limitedPort, accessToken)).toBe('RATE_LIMITED');
    } finally {
      await limitedApp.close();
    }
  });

  it('revokeRoomAccess разрывает подписки identity в комнате (REQ-SEC-003 hook)', async () => {
    const { room, accessToken } = await activeRoomWithGuest();
    const socket = await connect(port, accessToken);
    await emitAck(socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    const disconnected = new Promise<void>((resolve) => socket.on('disconnect', () => resolve()));
    const gateway = app.get(RealtimeGateway);
    const claims = tokens.verifyAccessToken(accessToken);
    gateway.revokeRoomAccess(claims.sub, room.id);
    await disconnected;
    // Повторный publish невозможен: подписки нет (сокет отключён сервером).
    expect(socket.connected).toBe(false);
  });

  it('исключение организатором: разрыв подписки, ACTOR_NOT_MEMBER на ресubscribe, refresh 401, rejoin 403 (критерий ф.1, REQ-SEC-003)', async () => {
    // join по HTTP с сохранением refresh-куки (activeRoomWithGuest её отбрасывает —
    // здесь путь развёрнут вручную ради куки). configure обязателен: activate без
    // пина отклоняется RoomNotConfiguredError (REQ-RT-004).
    const room = await roomService.create(ORG);
    await roomService.configure(room.id, {
      appId: 'test-app',
      manifestVersion: 1,
      settings: { label: 'live', orgNote: 'o', answers: { r1: 2 } },
    });
    await roomService.activate(room.id, ORG);
    const joinRes = await app.inject({
      method: 'POST',
      url: '/rooms/join',
      payload: { code: room.code, displayName: 'Гостя' },
    });
    expect(joinRes.statusCode).toBe(201);
    const { accessToken } = tokenResponseSchema.parse(joinRes.json());
    const refreshCookie = joinRes.cookies.find((c) => c.name === 'mm_refresh');
    expect(refreshCookie).toBeDefined();
    const participantId = tokens.verifyAccessToken(accessToken).sub;

    const socket = await connect(port, accessToken);
    await emitAck(socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    const disconnected = new Promise<void>((resolve) => socket.on('disconnect', () => resolve()));

    const orgToken = await organizerToken(room.id);
    const res = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/members/${participantId}/exclude`,
      headers: { authorization: `Bearer ${orgToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ excluded: true });
    await disconnected; // немедленный разрыв подписки (REQ-SEC-003)
    expect(socket.connected).toBe(false);

    // Старый access ещё валиден (≤15 мин), но членство мертво: subscribe → ACTOR_NOT_MEMBER.
    const socket2 = await connect(port, accessToken);
    const ack = await emitAck(socket2, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
    expect(ack).toEqual({ code: 'ACTOR_NOT_MEMBER' });
    socket2.close();

    // Refresh-сессия отозвана: перевыпуск access невозможен.
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { mm_refresh: refreshCookie!.value },
    });
    expect(refreshRes.statusCode).toBe(401);
    expect(refreshRes.json()).toEqual({ code: 'SESSION_INVALID' });

    // Rejoin с того же IP (app.inject → 127.0.0.1, как и первый join) → единообразный отказ.
    const rejoin = await app.inject({
      method: 'POST',
      url: '/rooms/join',
      payload: { code: room.code, displayName: 'Снова' },
    });
    expect(rejoin.statusCode).toBe(403);
    expect(rejoin.json()).toEqual({ code: 'ROOM_JOIN_DENIED' });
  });
});
