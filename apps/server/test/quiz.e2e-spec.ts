import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';
import { REALTIME_MESSAGES, tokenResponseSchema, type ProjectedEvent } from '@mymozhem/sdk';
import { QUIZ_APP_ID, QUIZ_MANIFEST_VERSION, type QuizSettings } from '@mymozhem/app-quiz';
import {
  AppRuntimeService,
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

// Boot зеркалит realtime.e2e/main.ts, но БЕЗ override'ов: composition root
// (app.module.ts) уже регистрирует quiz-манифест и рантайм глобально — подмена
// APP_MANIFESTS/APP_RUNTIME_MODULES не нужна.
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

// Ждём конкретное событие по типу (+ необязательный предикат): waitEvent из
// realtime.e2e без фильтра не подходит — в потоке квиза несколько типов.
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

// Локальная копия тест-хелпера packages/core/src/testing/read-room-log.ts: в barrel
// ядра он НЕ экспортирован (утверждение brief устарело), а спек standalone.
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

describe('Quiz (e2e, приёмка фазы 2)', () => {
  let db: TestDb;
  let app: NestFastifyApplication;
  let port: number;
  let roomService: RoomService;
  let tokens: TokenService;
  let runtime: AppRuntimeService;
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
    runtime = app.get(AppRuntimeService);
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

  // Комната квиза в ACTIVE (сервисный путь, прецедент realtime.e2e: configure
  // обязателен до activate; HTTP-эндпоинта configure нет — срез его не добавляет).
  // Тип — структурный: apps/server не зависит от @prisma/client напрямую.
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

  // Гость через HTTP (транспортный путь): POST /rooms/join → accessToken → connect.
  async function joinGuest(
    roomCode: string,
    name: string,
    role?: 'spectator',
  ): Promise<{ socket: ClientSocket; token: string; identityId: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/rooms/join',
      payload: { code: roomCode, displayName: name, ...(role ? { role } : {}) },
    });
    expect(res.statusCode).toBe(201);
    const { accessToken } = tokenResponseSchema.parse(res.json());
    const identityId = tokens.verifyAccessToken(accessToken).sub;
    return { socket: await connect(port, accessToken), token: accessToken, identityId };
  }

  // Организатор на ws: REGISTERED-токен без room-scope (прецедент realtime.e2e).
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

  it('1. полная игра: 2 раунда, скоростная шкала, standings; порядок live = порядку лога', async () => {
    const room = await activeQuizRoom(QUIZ_SETTINGS);
    const p1 = await joinGuest(room.code, 'P1');
    const p2 = await joinGuest(room.code, 'P2');
    const p3 = await joinGuest(room.code, 'P3'); // не отвечает ни разу
    const org = await organizerSocket();
    for (const s of [p1.socket, p2.socket, p3.socket, org]) {
      const ack = await subscribe(s, room.id);
      expect(ack.ok).toBe(true);
    }
    const feeds: ProjectedEvent[][] = [];
    for (const s of [p1.socket, p2.socket, p3.socket, org]) {
      const events: ProjectedEvent[] = [];
      s.on(REALTIME_MESSAGES.EVENT, (e: ProjectedEvent) => events.push(e));
      feeds.push(events);
    }

    // Раунд 0: P1 верно (1), P2 неверно (0).
    expect(await publish(org, 'quiz.question.opened', { questionIndex: 0 })).toEqual({ ok: true });
    expect(await publish(p1.socket, 'quiz.answer.submitted', { questionIndex: 0, optionIndex: 1 })).toEqual({ ok: true });
    expect(await publish(p2.socket, 'quiz.answer.submitted', { questionIndex: 0, optionIndex: 0 })).toEqual({ ok: true });
    const revealed0 = waitEventWhere(org, 'quiz.question.revealed');
    expect(await publish(org, 'quiz.question.closed', { questionIndex: 0 })).toEqual({ ok: true });
    expect((await revealed0).payload).toEqual({
      questionIndex: 0,
      correctIndex: 1,
      awarded: [{ actorId: p1.identityId, points: 1000 }],
      // Неверный ответ записи в totals не создаёт: totals перестраиваются только из awarded.
      totals: [{ actorId: p1.identityId, total: 1000 }],
    });

    // Раунд 1: оба верно, P2 первым (упорядочено await'ом ack до publish P1).
    expect(await publish(org, 'quiz.question.opened', { questionIndex: 1 })).toEqual({ ok: true });
    expect(await publish(p2.socket, 'quiz.answer.submitted', { questionIndex: 1, optionIndex: 1 })).toEqual({ ok: true });
    expect(await publish(p1.socket, 'quiz.answer.submitted', { questionIndex: 1, optionIndex: 1 })).toEqual({ ok: true });
    const revealed1 = waitEventWhere(org, 'quiz.question.revealed');
    expect(await publish(org, 'quiz.question.closed', { questionIndex: 1 })).toEqual({ ok: true });
    expect((await revealed1).payload).toEqual({
      questionIndex: 1,
      correctIndex: 1,
      awarded: [
        { actorId: p2.identityId, points: 1000 },
        { actorId: p1.identityId, points: 900 },
      ],
      totals: [
        { actorId: p1.identityId, total: 1900 },
        { actorId: p2.identityId, total: 1000 },
      ],
    });

    // Flush-маркеры навешиваем ДО publish: fan-out синхронен с коммитом, кадр
    // может прийти раньше ack — поздний waitEventWhere никогда не сработает.
    const finishedAll = [p1.socket, p2.socket, p3.socket, org].map((s) => waitEventWhere(s, 'quiz.game.finished'));
    const finishAck = await publish(org, 'quiz.game.finish', {});
    expect(finishAck).toEqual({ ok: true });
    const [finishedOrg] = await Promise.all(finishedAll);
    const standings = finishedOrg.payload['standings'] as unknown[];
    expect(standings).toEqual([
      { actorId: p1.identityId, total: 1900, place: 1 },
      { actorId: p2.identityId, total: 1000, place: 2 },
    ]);
    // P3 ни разу не отвечал: standings строятся из totals редьюсера — P3 в них
    // не попадает (зафиксированное поведение сценария 1 brief'а).
    expect(standings).toHaveLength(2);

    // Flush: все четыре клиента получили game.finished (последнее событие игры,
    // waitEventWhere выше уже дождался) — socket.io сохраняет порядок, значит
    // ленты полны.
    const expectedLive = [
      'quiz.question.opened',
      'quiz.answer.accepted',
      'quiz.answer.accepted',
      'quiz.question.closed',
      'quiz.question.revealed',
      'quiz.question.opened',
      'quiz.answer.accepted',
      'quiz.answer.accepted',
      'quiz.question.closed',
      'quiz.question.revealed',
      'quiz.game.finish',
      'quiz.game.finished',
    ];
    for (const events of feeds) {
      expect(events.map((e) => e.type)).toEqual(expectedLive);
    }
    // answer.accepted — public и БЕЗ optionIndex (выбор не раскрывается до reveal).
    for (const e of feeds[0]!.filter((e) => e.type === 'quiz.answer.accepted')) {
      expect(Object.keys(e.payload).sort()).toEqual(['actorId', 'questionIndex']);
    }
    // Порядок live-событий совпадает с порядком лога. Сырой лог отдаёт
    // DB-значения enum (lowercase, маппинг @map делает только Prisma-клиент).
    const log = await readRoomLog(db.prisma, room.id);
    const publicQuizTypes = log
      .filter((r) => r.visibility === 'public' && r.type.startsWith('quiz.'))
      .map((r) => r.type);
    expect(publicQuizTypes).toEqual(expectedLive);
    // module-private ответы — в логе (4 шт.), с actorId; наружу не ушли.
    expect(log.filter((r) => r.type === 'quiz.answer.submitted')).toHaveLength(4);

    for (const s of [p1.socket, p2.socket, p3.socket, org]) s.close();
  });

  it('2. чит-тест: до reveal нигде на проводе нет correctIndex/correctAnswers; replay легален, module-private никому', async () => {
    const room = await activeQuizRoom(QUIZ_SETTINGS);
    const p1 = await joinGuest(room.code, 'P1');
    const org = await organizerSocket();

    // Всё, что получили участник и организатор ДО question.revealed: ack'и
    // (subscribe/publish) и live-кадры.
    const preReveal: unknown[] = [];
    preReveal.push(await subscribe(p1.socket, room.id));
    preReveal.push(await subscribe(org, room.id));
    p1.socket.on(REALTIME_MESSAGES.EVENT, (e: unknown) => preReveal.push(e));
    org.on(REALTIME_MESSAGES.EVENT, (e: unknown) => preReveal.push(e));

    const openedP1 = waitEventWhere(p1.socket, 'quiz.question.opened');
    const openedOrg = waitEventWhere(org, 'quiz.question.opened');
    preReveal.push(await publish(org, 'quiz.question.opened', { questionIndex: 0 }));
    await openedP1;
    await openedOrg;

    const acceptedP1 = waitEventWhere(p1.socket, 'quiz.answer.accepted');
    const acceptedOrg = waitEventWhere(org, 'quiz.answer.accepted');
    preReveal.push(await publish(p1.socket, 'quiz.answer.submitted', { questionIndex: 0, optionIndex: 1 }));
    await acceptedP1;
    await acceptedOrg;

    // Ни один кадр/ack/snapshot до reveal не содержит значение correctIndex
    // (проверка сериализацией) и correctAnswers (appSettings внутри subscribe-ack).
    for (const frame of preReveal) {
      expect(JSON.stringify(frame)).not.toContain('"correctIndex"');
      expect(JSON.stringify(frame)).not.toContain('"correctAnswers"');
    }
    const p1Snap = preReveal[0] as SubscribeAck;
    const orgSnap = preReveal[1] as SubscribeAck;
    expect(p1Snap.snapshot.appSettings).not.toHaveProperty('correctAnswers');
    expect(orgSnap.snapshot.appSettings).not.toHaveProperty('correctAnswers');

    // Раскрытие — легально: correctIndex появляется ровно в question.revealed.
    const revealed = waitEventWhere(p1.socket, 'quiz.question.revealed');
    preReveal.push(await publish(org, 'quiz.question.closed', { questionIndex: 0 }));
    expect((await revealed).payload['correctIndex']).toBe(1);

    // Replay после раунда 0: question.revealed виден (раскрыт легально),
    // answer.submitted (module-private) отсутствует, correctAnswers нет.
    const replay = await connect(port, p1.token);
    const replayAck = await subscribe(replay, room.id);
    const replayTypes = replayAck.snapshot.events.map((e) => e.type);
    expect(replayTypes).toContain('quiz.question.revealed');
    expect(replayTypes).not.toContain('quiz.answer.submitted');
    expect(replayAck.snapshot.appSettings).not.toHaveProperty('correctAnswers');
    replay.close();

    // Организаторский snapshot тоже без correctAnswers и answer.submitted:
    // module-private не отдаётся никому (REQ-CORE-005).
    const orgReplay = await organizerSocket();
    const orgAck = await subscribe(orgReplay, room.id);
    const orgTypes = orgAck.snapshot.events.map((e) => e.type);
    expect(orgTypes).not.toContain('quiz.answer.submitted');
    expect(orgAck.snapshot.appSettings).not.toHaveProperty('correctAnswers');
    orgReplay.close();

    p1.socket.close();
    org.close();
  });

  it('3. late-join участника в ACTIVE в середине раунда: snapshot с открытым вопросом, ответ принят', async () => {
    const room = await activeQuizRoom(QUIZ_SETTINGS);
    const org = await organizerSocket();
    await subscribe(org, room.id);
    expect(await publish(org, 'quiz.question.opened', { questionIndex: 0 })).toEqual({ ok: true });

    const late = await joinGuest(room.code, 'Late');
    const ack = await subscribe(late.socket, room.id);
    const opened = ack.snapshot.events.find((e) => e.type === 'quiz.question.opened');
    expect(opened?.payload).toEqual({ questionIndex: 0 });
    // correctAnswers в snapshot нет даже на late-join (public-проекция appSettings).
    expect(ack.snapshot.appSettings).not.toHaveProperty('correctAnswers');

    expect(await publish(late.socket, 'quiz.answer.submitted', { questionIndex: 0, optionIndex: 1 })).toEqual({
      ok: true,
    });
    late.socket.close();
    org.close();
  });

  it('4. late-join зрителя: subscribe ok, snapshot public; publish → PUBLISH_FORBIDDEN, лог не изменился', async () => {
    const room = await activeQuizRoom(QUIZ_SETTINGS);
    const org = await organizerSocket();
    await subscribe(org, room.id);
    expect(await publish(org, 'quiz.question.opened', { questionIndex: 0 })).toEqual({ ok: true });

    const spectator = await joinGuest(room.code, 'Зритель', 'spectator');
    const ack = await subscribe(spectator.socket, room.id);
    expect(ack.ok).toBe(true);
    // Snapshot зрителя — public-проекция: открытый вопрос виден, приватного нет.
    expect(ack.snapshot.events.map((e) => e.type)).toContain('quiz.question.opened');
    expect(ack.snapshot.appSettings).not.toHaveProperty('correctAnswers');

    const before = (await readRoomLog(db.prisma, room.id)).length;
    expect(await publish(spectator.socket, 'quiz.answer.submitted', { questionIndex: 0, optionIndex: 0 })).toEqual({
      code: 'PUBLISH_FORBIDDEN',
    });
    expect((await readRoomLog(db.prisma, room.id)).length).toBe(before);
    spectator.socket.close();
    org.close();
  });

  it('5. анти-бот (REQ-RT-013): ответ раньше minAnswerIntervalMs → ANSWER_TOO_FAST; с 0 — принят', async () => {
    const slowRoom = await activeQuizRoom({ ...QUIZ_SETTINGS, minAnswerIntervalMs: 60_000 });
    const slowOrg = await organizerSocket();
    await subscribe(slowOrg, slowRoom.id);
    expect(await publish(slowOrg, 'quiz.question.opened', { questionIndex: 0 })).toEqual({ ok: true });
    const bot = await joinGuest(slowRoom.code, 'Бот');
    await subscribe(bot.socket, slowRoom.id);
    expect(await publish(bot.socket, 'quiz.answer.submitted', { questionIndex: 0, optionIndex: 1 })).toEqual({
      code: 'ANSWER_TOO_FAST',
    });
    const slowLog = await readRoomLog(db.prisma, slowRoom.id);
    expect(slowLog.filter((r) => r.type === 'quiz.answer.submitted')).toHaveLength(0);
    bot.socket.close();
    slowOrg.close();

    const fastRoom = await activeQuizRoom({ ...QUIZ_SETTINGS, minAnswerIntervalMs: 0 });
    const fastOrg = await organizerSocket();
    await subscribe(fastOrg, fastRoom.id);
    expect(await publish(fastOrg, 'quiz.question.opened', { questionIndex: 0 })).toEqual({ ok: true });
    const human = await joinGuest(fastRoom.code, 'Человек');
    await subscribe(human.socket, fastRoom.id);
    expect(await publish(human.socket, 'quiz.answer.submitted', { questionIndex: 0, optionIndex: 1 })).toEqual({
      ok: true,
    });
    human.socket.close();
    fastOrg.close();
  });

  it('6. конкурентный double-answer: ровно один ok, второй ALREADY_ANSWERED; в логе один answer.submitted', async () => {
    const room = await activeQuizRoom(QUIZ_SETTINGS);
    const org = await organizerSocket();
    await subscribe(org, room.id);
    expect(await publish(org, 'quiz.question.opened', { questionIndex: 0 })).toEqual({ ok: true });
    const p1 = await joinGuest(room.code, 'P1');
    await subscribe(p1.socket, room.id);

    const [a, b] = await Promise.all([
      publish(p1.socket, 'quiz.answer.submitted', { questionIndex: 0, optionIndex: 1 }),
      publish(p1.socket, 'quiz.answer.submitted', { questionIndex: 0, optionIndex: 1 }),
    ]);
    const oks = [a, b].filter((r): r is { ok: true } => 'ok' in r);
    const rejected = [a, b].filter((r): r is { code: string } => 'code' in r);
    expect(oks).toHaveLength(1);
    expect(rejected).toEqual([{ code: 'ALREADY_ANSWERED' }]);

    const log = await readRoomLog(db.prisma, room.id);
    expect(log.filter((r) => r.type === 'quiz.answer.submitted' && r.actorId === p1.identityId)).toHaveLength(1);
    p1.socket.close();
    org.close();
  });

  it('7. ролевые гейты: участнику question.opened и game.finish запрещены (PUBLISH_FORBIDDEN)', async () => {
    const room = await activeQuizRoom(QUIZ_SETTINGS);
    const p1 = await joinGuest(room.code, 'P1');
    await subscribe(p1.socket, room.id);
    expect(await publish(p1.socket, 'quiz.question.opened', { questionIndex: 0 })).toEqual({
      code: 'PUBLISH_FORBIDDEN',
    });
    expect(await publish(p1.socket, 'quiz.game.finish', {})).toEqual({ code: 'PUBLISH_FORBIDDEN' });
    p1.socket.close();
  });

  it('8. пересоздание проекции: invalidateProjection → replay восстанавливает состояние, очки включают раунд 0', async () => {
    const room = await activeQuizRoom(QUIZ_SETTINGS);
    const org = await organizerSocket();
    const p1 = await joinGuest(room.code, 'P1');
    await subscribe(org, room.id);
    await subscribe(p1.socket, room.id);

    // Раунд 0: P1 верно → 1000.
    expect(await publish(org, 'quiz.question.opened', { questionIndex: 0 })).toEqual({ ok: true });
    expect(await publish(p1.socket, 'quiz.answer.submitted', { questionIndex: 0, optionIndex: 1 })).toEqual({ ok: true });
    expect(await publish(org, 'quiz.question.closed', { questionIndex: 0 })).toEqual({ ok: true });

    // Холодный replay: проекция перестраивается редукцией лога.
    runtime.invalidateProjection(room.id);

    // Раунд 1: команды обрабатываются (state восстановлен), очки включают раунд 0.
    expect(await publish(org, 'quiz.question.opened', { questionIndex: 1 })).toEqual({ ok: true });
    expect(await publish(p1.socket, 'quiz.answer.submitted', { questionIndex: 1, optionIndex: 1 })).toEqual({ ok: true });
    const revealed = waitEventWhere(org, 'quiz.question.revealed');
    expect(await publish(org, 'quiz.question.closed', { questionIndex: 1 })).toEqual({ ok: true });
    expect((await revealed).payload).toEqual({
      questionIndex: 1,
      correctIndex: 1,
      awarded: [{ actorId: p1.identityId, points: 1000 }],
      totals: [{ actorId: p1.identityId, total: 2000 }],
    });
    p1.socket.close();
    org.close();
  });

  it('9. запечатанная комната: publish после COMPLETED → ROOM_LOG_SEALED', async () => {
    const room = await activeQuizRoom(QUIZ_SETTINGS);
    const org = await organizerSocket();
    await subscribe(org, room.id);
    await roomService.complete(room.id, ORG);
    expect(await publish(org, 'quiz.question.opened', { questionIndex: 0 })).toEqual({ code: 'ROOM_LOG_SEALED' });
    org.close();
  });
});
