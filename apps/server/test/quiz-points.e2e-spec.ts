import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';
import { REALTIME_MESSAGES, tokenResponseSchema, type ProjectedEvent } from '@mymozhem/sdk';
import { QUIZ_APP_ID, QUIZ_MANIFEST_VERSION, type QuizSettings } from '@mymozhem/app-quiz';
import {
  ConfigurableIoAdapter,
  loadConfig,
  RoomService,
  seedIdentity,
  startTestDb,
  TEST_CONFIG,
  TokenService,
  type PrismaService,
  type TestDb,
} from '@mymozhem/core';
import { AppModule } from '../src/app.module';

jest.setTimeout(180_000);

// RFC 9562-валидный v4 UUID (прецедент realtime.e2e): z.uuid() (zod v4) отклоняет
// версию 0 — иначе проекция core.room.activated (actorId = ORG) падает на parse.
const ORG = '00000000-0000-4000-8000-000000000001';

// Хелперы/бутстрап — копия quiz.e2e (спек standalone; quiz.e2e не правим — он
// остаётся приёмкой ф.2 на manifestVersion 2).
const QUIZ_SETTINGS: QuizSettings = {
  questions: [
    { text: '2+2?', options: ['3', '4'] },
    { text: 'Столица Франции?', options: ['Лион', 'Париж'] },
  ],
  correctAnswers: [1, 1],
  minAnswerIntervalMs: 0,
  scoring: { base: 1000, step: 100 },
};

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

// Boot зеркалит quiz.e2e, БЕЗ override'ов: composition root (app.module.ts)
// регистрирует quiz@2 + lottery, RewardsModule (@Global, AWARD_EFFECT_HANDLER) —
// тест гоняет фактический composition root (прецедент lottery.e2e).
async function createApp(envOverrides: Record<string, string> = {}): Promise<NestFastifyApplication> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    const config = loadConfig(process.env);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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

// Подписку навешиваем ДО триггерящего publish: fan-out синхронен с коммитом,
// кадр может прийти раньше ack.
function waitEventWhere(
  socket: ClientSocket,
  type: string,
  pred: (e: ProjectedEvent) => boolean = () => true,
): Promise<ProjectedEvent> {
  return new Promise((resolve) => {
    const handler = (e: ProjectedEvent) => {
      if (e.type === type && pred(e)) {
        socket.off(REALTIME_MESSAGES.EVENT, handler);
        resolve(e);
      }
    };
    socket.on(REALTIME_MESSAGES.EVENT, handler);
  });
}

type RoomLogRow = {
  roomId: string;
  seq: number;
  type: string;
  payload: unknown;
  actorId: string | null;
  visibility: string;
  schemaVersion: number;
};

// Локальная копия тест-хелпера packages/core/src/testing/read-room-log.ts
// (в barrel ядра не экспортирован), как в quiz.e2e.
function readRoomLog(prisma: PrismaService, roomId: string): Promise<RoomLogRow[]> {
  return prisma.$queryRaw<RoomLogRow[]>`
    SELECT "roomId", "seq", "type", "payload", "actorId",
           "visibility"::text AS "visibility", "schemaVersion"
    FROM realtime."LogEvent"
    WHERE "roomId" = ${roomId}::uuid
    ORDER BY "seq"
  `;
}

type SubscribeAck = {
  ok: true;
  snapshot: { events: ProjectedEvent[]; appSettings: Record<string, unknown> };
};
type PublishAck = { ok: true } | { code: string };

describe('Quiz points ↔ rewards ledger (e2e, приёмка фазы 3)', () => {
  let db: TestDb;
  let app: NestFastifyApplication;
  let port: number;
  let roomService: RoomService;
  let tokens: TokenService;
  let savedDatabaseUrl: string | undefined;
  let savedJwtSecret: string | undefined;

  beforeAll(async () => {
    savedDatabaseUrl = process.env.DATABASE_URL;
    savedJwtSecret = process.env.JWT_SECRET;
    db = await startTestDb();
    process.env.JWT_SECRET = TEST_CONFIG.JWT_SECRET;
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    app = await createApp();
    port = portOf(app);
    roomService = app.get(RoomService);
    tokens = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
    await db.stop();
    restoreEnv('DATABASE_URL', savedDatabaseUrl);
    restoreEnv('JWT_SECRET', savedJwtSecret);
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE rewards."Award", rewards."Prize", rewards."PointsGrant", identity."Session", membership."Membership", room."Room" CASCADE',
    );
  });

  async function activeQuizRoom(settings: QuizSettings): Promise<{ id: string; code: string }> {
    const room = await roomService.create(ORG);
    await roomService.configure(room.id, {
      appId: QUIZ_APP_ID,
      manifestVersion: QUIZ_MANIFEST_VERSION,
      settings,
    });
    await roomService.activate(room.id, ORG);
    return room;
  }

  async function joinGuest(
    roomCode: string,
    name: string,
  ): Promise<{ socket: ClientSocket; token: string; identityId: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/rooms/join',
      payload: { code: roomCode, displayName: name },
    });
    expect(res.statusCode).toBe(201);
    const { accessToken } = tokenResponseSchema.parse(res.json());
    const identityId = tokens.verifyAccessToken(accessToken).sub;
    return { socket: await connect(port, accessToken), token: accessToken, identityId };
  }

  async function organizerSocket(): Promise<ClientSocket> {
    const issued = await tokens.issueRegisteredTokens(ORG);
    return connect(port, issued.accessToken);
  }

  function subscribe(socket: ClientSocket, roomId: string): Promise<SubscribeAck> {
    return emitAck<SubscribeAck>(socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId });
  }

  function publish(socket: ClientSocket, type: string, payload: Record<string, unknown>): Promise<PublishAck> {
    return emitAck<PublishAck>(socket, REALTIME_MESSAGES.PUBLISH, { type, payload });
  }

  it('1. после reveal ledger-записи появляются и сходятся с табло; повторный закрытый раунд не дублирует начисления', async () => {
    const room = await activeQuizRoom(QUIZ_SETTINGS);
    const p1 = await joinGuest(room.code, 'Гость P1');
    const p2 = await joinGuest(room.code, 'Гость P2');
    const org = await organizerSocket();
    for (const s of [p1.socket, p2.socket, org]) {
      const ack = await subscribe(s, room.id);
      expect(ack.ok).toBe(true);
    }

    // Раунд 0: оба верно, P2 первым (1000), P1 вторым (900) — порядок
    // упорядочен await'ом ack до publish следующего ответа.
    expect(await publish(org, 'quiz.question.opened', { questionIndex: 0 })).toEqual({ ok: true });
    expect(await publish(p2.socket, 'quiz.answer.submitted', { questionIndex: 0, optionIndex: 1 })).toEqual({
      ok: true,
    });
    expect(await publish(p1.socket, 'quiz.answer.submitted', { questionIndex: 0, optionIndex: 1 })).toEqual({
      ok: true,
    });
    const revealed0 = waitEventWhere(org, 'quiz.question.revealed');
    expect(await publish(org, 'quiz.question.closed', { questionIndex: 0 })).toEqual({ ok: true });
    expect((await revealed0).payload['awarded']).toEqual([
      { actorId: p2.identityId, points: 1000 },
      { actorId: p1.identityId, points: 900 },
    ]);

    // Раунд 1: только P1 верно (1000).
    expect(await publish(org, 'quiz.question.opened', { questionIndex: 1 })).toEqual({ ok: true });
    expect(await publish(p1.socket, 'quiz.answer.submitted', { questionIndex: 1, optionIndex: 1 })).toEqual({
      ok: true,
    });
    const revealed1 = waitEventWhere(org, 'quiz.question.revealed');
    expect(await publish(org, 'quiz.question.closed', { questionIndex: 1 })).toEqual({ ok: true });
    expect((await revealed1).payload['awarded']).toEqual([{ actorId: p1.identityId, points: 1000 }]);

    // Ledger: ровно 3 гранта, все — квизовые начисления раунда (REQ-RWD-002b:
    // начисление без приза).
    const grants = await db.prisma.pointsGrant.findMany({
      where: { roomId: room.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(grants).toHaveLength(3);
    expect(grants.every((g) => g.reason === 'quiz.round' && g.sourceAppId === 'quiz')).toBe(true);

    // Сходимость (design §5): табло квиза строится проекцией из awarded
    // reveal-событий, ledger — грантами, записанными эффектами в той же
    // транзакции, что и reveal. Суммы по участникам обязаны совпасть.
    const log = await readRoomLog(db.prisma, room.id);
    const awarded = log
      .filter((e) => e.type === 'quiz.question.revealed')
      .flatMap((e) => (e.payload as { awarded: { actorId: string; points: number }[] }).awarded);
    const ledgerTotals = new Map<string, number>();
    for (const g of grants) ledgerTotals.set(g.identityId, (ledgerTotals.get(g.identityId) ?? 0) + g.points);
    const boardTotals = new Map<string, number>();
    for (const a of awarded) boardTotals.set(a.actorId, (boardTotals.get(a.actorId) ?? 0) + a.points);
    expect(Object.fromEntries(ledgerTotals)).toEqual(Object.fromEntries(boardTotals));
    expect(ledgerTotals.get(p1.identityId)).toBe(1900);
    expect(ledgerTotals.get(p2.identityId)).toBe(1000);

    // Идемпотентность: повторный question.closed того же раунда → ROUND_NOT_OPEN,
    // грантов не добавилось.
    expect(await publish(org, 'quiz.question.closed', { questionIndex: 1 })).toEqual({ code: 'ROUND_NOT_OPEN' });
    expect(await db.prisma.pointsGrant.findMany({ where: { roomId: room.id } })).toHaveLength(3);

    // PII (REQ-SEC-009): ни один payload лога (reveal и прочие события) не несёт
    // displayName — awarded несут actorId, не имена.
    for (const e of log) {
      expect(JSON.stringify(e.payload)).not.toContain('Гость');
    }

    for (const s of [p1.socket, p2.socket, org]) s.close();
  });

  it('2. configure с пином quiz@1 отклоняется APP_MANIFEST_UNKNOWN: v1 не конфигурируется там, где зарегистрирован только quiz@2', async () => {
    // Скетч плана (publish → MODULE_UNAVAILABLE) недостижим: configure/activate
    // fail-closed против boot-time реестра (REQ-CORE-007, activate повторно
    // валидирует настройки на DRAFT→ACTIVE). Сам MODULE_UNAVAILABLE на publish
    // покрыт app-runtime.int-spec кейсом 4 (ruling E-13.1). Здесь фиксируем
    // фактическое поведение composition root'а: старый манифест не принимается.
    const room = await roomService.create(ORG);
    const err = await roomService
      .configure(room.id, {
        appId: QUIZ_APP_ID,
        manifestVersion: 1,
        settings: QUIZ_SETTINGS,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { code: string }).code).toBe('APP_MANIFEST_UNKNOWN');
  });
});
