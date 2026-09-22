import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';
import { REALTIME_MESSAGES, tokenResponseSchema, type ProjectedEvent } from '@mymozhem/sdk';
import { LOTTERY_APP_ID, LOTTERY_MANIFEST_VERSION, type LotterySettings } from '@mymozhem/app-lottery';
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
// REGISTERED-участник сценария 4 (verified eligibility).
const REG = '00000000-0000-4000-8000-000000000002';

const LOTTERY_SETTINGS: LotterySettings = { drawEligibility: 'guests_allowed' };

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

// Boot зеркалит quiz.e2e (composition root регистрирует lottery + rewards глобально —
// override'ы APP_MANIFESTS/APP_RUNTIME_MODULES не нужны, прецедент quiz.e2e).
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

// Ждём конкретное событие по типу (+ необязательный предикат). Подписку навешиваем
// ДО триггерящего publish/REST-вызова: fan-out синхронен с коммитом, кадр может
// прийти раньше ack/ответа (опыт Quiz-среза, HANDOFF).
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
// ядра он НЕ экспортирован (санкционированное отклонение Quiz-среза), спек standalone.
// Сырой лог отдаёт DB-значения enum (visibility lowercase).
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

describe('Lottery (e2e, приёмка фазы 3)', () => {
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
      'TRUNCATE TABLE identity."Session", membership."Membership", rewards."Award", rewards."Prize", room."Room" CASCADE',
    );
  });

  // Комната лотереи в ACTIVE (сервисный путь, прецедент quiz.e2e). Settings — всегда
  // явно: открытый вопрос контракта о дефолте, `{}` отклоняется.
  async function activeLotteryRoom(
    settings: LotterySettings = LOTTERY_SETTINGS,
  ): Promise<{ id: string; code: string }> {
    const room = await roomService.create(ORG);
    await roomService.configure(room.id, {
      appId: LOTTERY_APP_ID,
      manifestVersion: LOTTERY_MANIFEST_VERSION,
      settings,
    });
    await roomService.activate(room.id, ORG);
    return room;
  }

  // Гость через HTTP (транспортный путь): POST /rooms/join → accessToken → connect.
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

  // REST с Bearer организатора: guest-claims (kind GUEST + roomId), роль ORGANIZER
  // берётся из membership — прецедент transport.e2e-spec.ts:362-367.
  async function organizerRestToken(roomId: string): Promise<string> {
    return (await tokens.issueGuestTokens(ORG, roomId)).accessToken;
  }

  async function createPrize(roomId: string, name: string, quantity: number): Promise<{ id: string }> {
    const res = await app.inject({
      method: 'POST',
      url: `/rooms/${roomId}/prizes`,
      headers: { authorization: `Bearer ${await organizerRestToken(roomId)}` },
      payload: { name, quantity },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  async function fulfillAward(roomId: string, awardId: string) {
    return app.inject({
      method: 'POST',
      url: `/rooms/${roomId}/awards/${awardId}/fulfill`,
      headers: { authorization: `Bearer ${await organizerRestToken(roomId)}` },
    });
  }

  async function revokeAward(roomId: string, awardId: string) {
    return app.inject({
      method: 'POST',
      url: `/rooms/${roomId}/awards/${awardId}/revoke`,
      headers: { authorization: `Bearer ${await organizerRestToken(roomId)}` },
    });
  }

  // Организатор на ws: guest-claims токен, роль из membership; subscribe сразу —
  // publish адресуется комнатой подписки (roomId в publish-body не принимается,
  // publishRequestSchema strict).
  async function organizerSocket(roomId: string): Promise<ClientSocket> {
    const socket = await connect(port, await organizerRestToken(roomId));
    const ack = await emitAck<SubscribeAck>(socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId });
    expect(ack.ok).toBe(true);
    return socket;
  }

  function subscribe(socket: ClientSocket, roomId: string): Promise<SubscribeAck> {
    return emitAck<SubscribeAck>(socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId });
  }

  function publish(socket: ClientSocket, type: string, payload: Record<string, unknown>): Promise<PublishAck> {
    return emitAck<PublishAck>(socket, REALTIME_MESSAGES.PUBLISH, { type, payload });
  }

  function runDraw(orgSocket: ClientSocket, drawId: string, prizeId: string): Promise<PublishAck> {
    return publish(orgSocket, 'lottery.draw.run', { drawId, prizeId });
  }

  it('1. полный цикл: гости входят → приз → draw.run → draw.completed из пула → AWARDED → fulfill; события публичны live и в replay', async () => {
    const room = await activeLotteryRoom();
    const g1 = await joinGuest(room.code, 'Гость-1');
    const g2 = await joinGuest(room.code, 'Гость-2');
    expect((await subscribe(g1.socket, room.id)).ok).toBe(true);
    expect((await subscribe(g2.socket, room.id)).ok).toBe(true);
    const prize = await createPrize(room.id, 'Главный приз', 1);

    const orgSocket = await organizerSocket(room.id);
    // Waiters ДО publish: fan-out синхронен с коммитом (опыт Quiz-среза).
    const guestFrame = waitEventWhere(g1.socket, 'lottery.draw.completed');
    const rewardFrame = waitEventWhere(g2.socket, 'rewards.reward.awarded');

    const drawId = crypto.randomUUID();
    expect(await runDraw(orgSocket, drawId, prize.id)).toEqual({ ok: true });

    const completed = await guestFrame;
    const winnerId = (completed.payload as { winnerId: string }).winnerId;
    expect([g1.identityId, g2.identityId]).toContain(winnerId); // победитель из пула
    expect(completed.payload).toMatchObject({ drawId, prizeId: prize.id });
    expect(completed.payload).not.toHaveProperty('displayName'); // REQ-SEC-009
    expect(((await rewardFrame).payload as { winnerId: string }).winnerId).toBe(winnerId);

    // Состояние в БД: награда AWARDED, фонд списан ровно на 1.
    const award = await db.prisma.award.findFirstOrThrow({ where: { roomId: room.id } });
    expect(award).toMatchObject({ prizeId: prize.id, winnerId, status: 'AWARDED', sourceAppId: 'lottery' });
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(0);

    // Replay: переподключённый гость видит оба события в snapshot.
    const again = await joinGuest(room.code, 'Гость-1-снова');
    const sub = await subscribe(again.socket, room.id);
    const types = sub.snapshot.events.map((e) => e.type);
    expect(types).toContain('lottery.draw.completed');
    expect(types).toContain('rewards.reward.awarded');

    // Вручение очное (REQ-RWD-004): REST fulfill → 200 + публичное rewards.reward.fulfilled.
    const fulfillFrame = waitEventWhere(g1.socket, 'rewards.reward.fulfilled');
    const res = await fulfillAward(room.id, award.id);
    expect(res.statusCode).toBe(200);
    await fulfillFrame;
    expect((await db.prisma.award.findUniqueOrThrow({ where: { id: award.id } })).status).toBe('FULFILLED');

    for (const s of [g1.socket, g2.socket, again.socket, orgSocket]) s.close();
  });

  it('2. повтор draw.run с тем же drawId — no-op: второй розыгрыш не состоялся, фонд не списан (REQ-RWD-003 на уровне app-команды)', async () => {
    const room = await activeLotteryRoom();
    const g = await joinGuest(room.code, 'Гость');
    const prize = await createPrize(room.id, 'Приз', 2);
    const orgSocket = await organizerSocket(room.id);
    const drawId = crypto.randomUUID();
    expect(await runDraw(orgSocket, drawId, prize.id)).toEqual({ ok: true });
    const again = await runDraw(orgSocket, drawId, prize.id);
    expect(again).toEqual({ ok: true }); // типизированный no-op, не отказ
    expect(await db.prisma.award.count({ where: { roomId: room.id } })).toBe(1);
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(1);
    // Re-emit прежнего результата: в логе два draw.completed с одним drawId/winnerId.
    const log = await readRoomLog(db.prisma, room.id);
    const completions = log.filter((e) => e.type === 'lottery.draw.completed');
    expect(completions).toHaveLength(2);
    expect(completions[0]!.payload).toEqual(completions[1]!.payload);
    g.socket.close();
    orgSocket.close();
  });

  it('3. K > quantity конкурентных draw.run → ровно quantity победителей, без минуса (REQ-RWD-010, e2e-версия)', async () => {
    const room = await activeLotteryRoom();
    const g1 = await joinGuest(room.code, 'Гость-1');
    const g2 = await joinGuest(room.code, 'Гость-2');
    const g3 = await joinGuest(room.code, 'Гость-3');
    const prize = await createPrize(room.id, 'Приз', 1);
    const orgSocket = await organizerSocket(room.id);
    const acks = await Promise.all([
      runDraw(orgSocket, crypto.randomUUID(), prize.id),
      runDraw(orgSocket, crypto.randomUUID(), prize.id),
    ]);
    // RoomSerializer сериализует однокомнатные команды: второй draw видит пул без
    // первого победителя, но фонд уже пуст → PRIZE_FUND_EXHAUSTED, транзакция
    // откатывается целиком (коммит draw.run второго розыгрыша тоже не ложится).
    const oks = acks.filter((a): a is { ok: true } => 'ok' in a);
    const rejects = acks.filter((a): a is { code: string } => 'code' in a);
    expect(oks).toHaveLength(1);
    expect(rejects).toEqual([{ code: 'PRIZE_FUND_EXHAUSTED' }]);
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(0);
    expect(await db.prisma.award.count({ where: { roomId: room.id } })).toBe(1);
    for (const s of [g1.socket, g2.socket, g3.socket, orgSocket]) s.close();
  });

  it('4. eligibility verified: победитель всегда REGISTERED (REQ-RWD-014); гость при дефолте guests_allowed может выиграть (контроль — сценарий 1)', async () => {
    // Рулинг D-pre.2 (поправка к brief): sketch «10 розыгрышей с quantity 10 → все
    // winnerId === registered.id» противоречил реализованному исключению прежних
    // победителей ЭТОГО приза из пула (lottery-handlers.ts: после первого розыгрыша
    // единственный eligible REGISTERED исключён → DRAW_POOL_EMPTY на повторах).
    // Вместо этого — ОДИН розыгрыш (quantity 1): пул verified = {registered}
    // детерминированно, гости отфильтрованы.
    // HTTP-входа для REGISTERED нет (JoinController создаёт только гостей) —
    // членство REGISTERED-партисипанта сеем на уровне БД; пул розыгрыша читается
    // из membership (listActiveParticipantPool), так что это честная посадка.
    const room = await activeLotteryRoom({ drawEligibility: 'verified' });
    const g1 = await joinGuest(room.code, 'Гость-1');
    const g2 = await joinGuest(room.code, 'Гость-2');
    await seedIdentity(db.prisma, { id: REG, kind: 'REGISTERED' });
    await db.prisma.membership.create({
      data: { roomId: room.id, identityId: REG, role: 'PARTICIPANT' },
    });
    const prize = await createPrize(room.id, 'Приз', 1);
    const orgSocket = await organizerSocket(room.id);

    const completedFrame = waitEventWhere(orgSocket, 'lottery.draw.completed');
    const drawId = crypto.randomUUID();
    expect(await runDraw(orgSocket, drawId, prize.id)).toEqual({ ok: true });
    expect((await completedFrame).payload).toEqual({ drawId, prizeId: prize.id, winnerId: REG });

    const award = await db.prisma.award.findFirstOrThrow({ where: { roomId: room.id } });
    expect(award.winnerId).toBe(REG);
    g1.socket.close();
    g2.socket.close();
    orgSocket.close();
  });

  it('5. revoke возвращает quantity ровно один раз и освобождает фонд: приз переразыгрывается (REQ-RWD-007)', async () => {
    // Поправка к sketch brief'а («переразыгрывается ТОМУ ЖЕ победителю»): то же
    // исключение прежних победителей, что в рулинге D-pre.2, — прежний победитель
    // вне пула повторного розыгрыша (state.draws не забывает draw.completed даже
    // после revoke). Поэтому пул из 2 гостей: повторный розыгрыш детерминированно
    // уходит ДРУГОМУ участнику. REQ-RWD-007 проверяется полностью: возврат quantity
    // ровно один раз + новый AWARDED.
    const room = await activeLotteryRoom();
    const g1 = await joinGuest(room.code, 'Гость-1');
    const g2 = await joinGuest(room.code, 'Гость-2');
    const prize = await createPrize(room.id, 'Приз', 1);
    const orgSocket = await organizerSocket(room.id);

    expect(await runDraw(orgSocket, crypto.randomUUID(), prize.id)).toEqual({ ok: true });
    const award1 = await db.prisma.award.findFirstOrThrow({ where: { roomId: room.id } });
    const winner1 = award1.winnerId;
    expect([g1.identityId, g2.identityId]).toContain(winner1);
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(0);

    // Revoke (REST) → quantity возвращён; повторный revoke — типизированный no-op,
    // quantity НЕ возвращается дважды (REQ-RWD-007).
    const revokedFrame = waitEventWhere(orgSocket, 'rewards.reward.revoked');
    const revokeRes = await revokeAward(room.id, award1.id);
    expect(revokeRes.statusCode).toBe(200);
    expect((revokeRes.json() as { status: string }).status).toBe('REVOKED');
    await revokedFrame;
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(1);
    expect((await revokeAward(room.id, award1.id)).statusCode).toBe(200);
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(1);

    // Повторный розыгрыш другим drawId → новый AWARDED другому участнику пула
    // (прежний победитель исключён), фонд списан снова.
    const awardedFrame = waitEventWhere(orgSocket, 'rewards.reward.awarded');
    expect(await runDraw(orgSocket, crypto.randomUUID(), prize.id)).toEqual({ ok: true });
    const winner2 = ((await awardedFrame).payload as { winnerId: string }).winnerId;
    const expectedWinner2 = winner1 === g1.identityId ? g2.identityId : g1.identityId;
    expect(winner2).toBe(expectedWinner2);
    const awards = await db.prisma.award.findMany({ where: { roomId: room.id }, orderBy: { createdAt: 'asc' } });
    expect(awards).toHaveLength(2);
    expect(awards[0]).toMatchObject({ id: award1.id, status: 'REVOKED' });
    expect(awards[1]).toMatchObject({ winnerId: expectedWinner2, status: 'AWARDED', sourceAppId: 'lottery' });
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(0);

    // В логе — публичный след: revoke и оба awarded.
    const logTypes = (await readRoomLog(db.prisma, room.id)).map((r) => r.type);
    expect(logTypes.filter((t) => t === 'rewards.reward.revoked')).toHaveLength(1);
    expect(logTypes.filter((t) => t === 'rewards.reward.awarded')).toHaveLength(2);
    g1.socket.close();
    g2.socket.close();
    orgSocket.close();
  });

  it('6. REQ-RWD-009: при COMPLETED организатор видит оставшиеся AWARDED и вручает их по REST', async () => {
    const room = await activeLotteryRoom();
    const g = await joinGuest(room.code, 'Гость');
    const prize = await createPrize(room.id, 'Приз', 1);
    const orgSocket = await organizerSocket(room.id);
    expect(await runDraw(orgSocket, crypto.randomUUID(), prize.id)).toEqual({ ok: true });
    await roomService.complete(room.id, ORG);

    const list = await app.inject({
      method: 'GET',
      url: `/rooms/${room.id}/rewards`,
      headers: { authorization: `Bearer ${await organizerRestToken(room.id)}` },
    });
    expect(list.statusCode).toBe(200);
    const awards = (list.json() as { awards: { id: string; status: string }[] }).awards;
    expect(awards).toHaveLength(1);
    expect(awards[0]!.status).toBe('AWARDED');

    // Вручение после завершения работает (REQ-RWD-009): rewards.* коммитятся
    // статическим путём без ACTIVE-гейта, в отличие от app-событий.
    const fulfill = await fulfillAward(room.id, awards[0]!.id);
    expect(fulfill.statusCode).toBe(200);
    expect((await db.prisma.award.findUniqueOrThrow({ where: { id: awards[0]!.id } })).status).toBe('FULFILLED');
    g.socket.close();
    orgSocket.close();
  });

  it('7. publish-гейты: draw.completed — server-only (clientInitiated=false), draw.run — только организатору; оба → PUBLISH_FORBIDDEN', async () => {
    const room = await activeLotteryRoom();
    const g = await joinGuest(room.code, 'Гость');
    expect((await subscribe(g.socket, room.id)).ok).toBe(true);
    // Server-only тип: гейт диспетчера до вызова модуля (заниженная visibility
    // клиентом невозможна в принципе — набор коммитов определяет модуль, REQ-CTR-009).
    expect(
      await publish(g.socket, 'lottery.draw.completed', {
        drawId: crypto.randomUUID(),
        prizeId: crypto.randomUUID(),
        winnerId: g.identityId,
      }),
    ).toEqual({ code: 'PUBLISH_FORBIDDEN' });
    // clientInitiated, но роль PARTICIPANT — отказ модуля.
    expect(
      await publish(g.socket, 'lottery.draw.run', { drawId: crypto.randomUUID(), prizeId: crypto.randomUUID() }),
    ).toEqual({ code: 'PUBLISH_FORBIDDEN' });
    g.socket.close();
  });
});
