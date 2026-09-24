import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { APP_FILTER } from '@nestjs/core';
import { z } from 'zod';
import { defineApp, validManifests } from '@mymozhem/sdk';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { AppRuntimeModule } from '../app-runtime/app-runtime.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG } from '../config/config.tokens';
import { MembershipModule } from '../membership/membership.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { HttpExceptionFilter } from './http-exception.filter';
import { TokenService } from '../auth/token.service';
import { RoomService } from '../room/room.service';
import { RoomModule } from '../room/room.module';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { readRoomLog } from '../testing/read-room-log';
import { TEST_CONFIG } from '../testing/test-config';
import { RoomsLifecycleController } from './rooms-lifecycle.controller';

// quiz@1 из SDK-фикстур: appSettings требует { title: string, correctAnswers: number[] }
// (прецедент room.service.int-spec.ts).
const QUIZ_SETTINGS = { title: 'Friday quiz', correctAnswers: [0, 2] };

// Зеркало appSettings реальной лотереи (packages/app-lottery/src/lottery-settings.ts):
// единственный ключ defaulted → {} проходит verdict-only гейт (P1: toRegisteredSchema
// в io:'input', REQ-RWD-014). Прямой импорт app-пакета ядру запрещён boundary-правилом,
// поэтому манифест собираем через defineApp — тем же путём, что само приложение.
const lotteryManifest = defineApp({
  appId: 'lottery',
  manifestVersion: 1,
  capabilities: ['rewards'],
  appSettings: z.strictObject({
    drawEligibility: z
      .enum(['guests_allowed', 'verified'])
      .default('guests_allowed')
      .meta({ 'x-visibility': 'public' }),
  }),
  events: {},
});

// HTTP-контур lifecycle комнаты (дизайн UI-среза, решение №9): configure/activate/
// complete/cancel организатором по HTTP. Паттерн — rewards.controller.int-spec.ts:
// testcontainers, сидирование через сервисы, HTTP через app.inject, статусы/тела на
// границе (REQ-SEC-006: наружу ровно {code}).
describe('RoomsLifecycleController (int)', () => {
  let db: TestDb;
  let app: NestFastifyApplication;
  let tokens: TokenService;
  let roomService: RoomService;

  const ORG = '00000000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    db = await startTestDb();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        PrismaModule,
        AppRegistryModule.register([validManifests[0], lotteryManifest]),
        // RealtimeGateway (провайдер RealtimeModule) разрешает AppRuntimeService
        // через global-провайдер — без register DI не собирается.
        AppRuntimeModule.register([]),
        AuthModule,
        MembershipModule,
        RealtimeModule,
        RoomModule,
      ],
      controllers: [RoomsLifecycleController],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    })
      // ConfigModule читает process.env — в int-лайне подменяем инертным конфигом.
      .overrideProvider(APP_CONFIG)
      .useValue(TEST_CONFIG)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.listen(0, '127.0.0.1');
    tokens = app.get(TokenService);
    roomService = app.get(RoomService);
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE realtime."LogEvent", identity."Session", membership."Membership", room."Room" CASCADE',
    );
  });

  // organizerToken — guest-claims, роль ORGANIZER из membership (прецедент
  // rewards.controller.int-spec.ts).
  async function orgRoom() {
    const room = await roomService.create(ORG);
    const { accessToken } = await tokens.issueGuestTokens(ORG, room.id);
    return { room, token: accessToken };
  }
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it('configure happy: organizer sets quiz settings in DRAFT → 200, echo status DRAFT', async () => {
    const { room, token } = await orgRoom();
    const res = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/configure`,
      headers: auth(token),
      payload: { appId: 'quiz', manifestVersion: 1, settings: QUIZ_SETTINGS },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      roomId: room.id,
      code: room.code,
      joinPolicy: 'guests',
      status: 'DRAFT',
    });
    // Тройка записана атомарно (REQ-RT-004) — прямая проверка строки.
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.appId).toBe('quiz');
    expect(reread.manifestVersion).toBe(1);
    expect(reread.appSettings).toEqual(QUIZ_SETTINGS);
  });

  it('configure with {} for lottery app passes the gate (P1 end-to-end, REQ-RWD-014)', async () => {
    const { room, token } = await orgRoom();
    const res = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/configure`,
      headers: auth(token),
      payload: { appId: 'lottery', manifestVersion: 1, settings: {} },
    });
    expect(res.statusCode).toBe(200);
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.appId).toBe('lottery');
    expect(reread.appSettings).toEqual({});
  });

  it('configure as PARTICIPANT → 403 ACTOR_NOT_ORGANIZER', async () => {
    const { room } = await orgRoom();
    const guest = await seedIdentity(db.prisma, { kind: 'GUEST' });
    await db.prisma.membership.create({
      data: { roomId: room.id, identityId: guest.id, role: 'PARTICIPANT', joinIp: '127.0.0.1' },
    });
    const guestToken = (await tokens.issueGuestTokens(guest.id, room.id)).accessToken;
    const res = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/configure`,
      headers: auth(guestToken),
      payload: { appId: 'quiz', manifestVersion: 1, settings: QUIZ_SETTINGS },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: 'ACTOR_NOT_ORGANIZER' });
  });

  it('configure without token → 401', async () => {
    const { room } = await orgRoom();
    const res = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/configure`,
      payload: { appId: 'quiz', manifestVersion: 1, settings: QUIZ_SETTINGS },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'SESSION_INVALID' });
  });

  // Негативная граница zod на транспорте (ревью батча 1): manifestVersion — строго
  // положительный int по configureRoomRequestSchema; отказ — 400 REQUEST_INVALID до
  // обращения к домену.
  it.each([{ manifestVersion: 0 }, { manifestVersion: 1.5 }])(
    'configure with manifestVersion $manifestVersion → 400 REQUEST_INVALID',
    async ({ manifestVersion }) => {
      const { room, token } = await orgRoom();
      const res = await app.inject({
        method: 'POST',
        url: `/rooms/${room.id}/configure`,
        headers: auth(token),
        payload: { appId: 'quiz', manifestVersion, settings: QUIZ_SETTINGS },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ code: 'REQUEST_INVALID' });
    },
  );

  it('activate → 200 ACTIVE + core.room.activated в логе; повторный activate → ROOM_TRANSITION_INVALID', async () => {
    const { room, token } = await orgRoom();
    await roomService.configure(room.id, { appId: 'quiz', manifestVersion: 1, settings: QUIZ_SETTINGS });

    const activated = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/activate`,
      headers: auth(token),
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json()).toMatchObject({ roomId: room.id, status: 'ACTIVE' });

    // Эмит перехода — пин замороженной тройки (REQ-RT-004/010); actorId — из access
    // JWT (REQ-RT-009 по духу HTTP), не из payload.
    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      seq: 1,
      type: 'core.room.activated',
      visibility: 'public',
      actorId: ORG,
      payload: { appId: 'quiz', manifestVersion: 1 },
    });

    const again = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/activate`,
      headers: auth(token),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: 'ROOM_TRANSITION_INVALID' });
  });

  it('complete after ACTIVE → 200 COMPLETED; cancel from DRAFT → 200 CANCELLED', async () => {
    const { room, token } = await orgRoom();
    await roomService.configure(room.id, { appId: 'quiz', manifestVersion: 1, settings: QUIZ_SETTINGS });
    await roomService.activate(room.id, ORG);

    const completed = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/complete`,
      headers: auth(token),
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ roomId: room.id, status: 'COMPLETED' });

    const { room: draft, token: draftToken } = await orgRoom();
    const cancelled = await app.inject({
      method: 'POST',
      url: `/rooms/${draft.id}/cancel`,
      headers: auth(draftToken),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ roomId: draft.id, status: 'CANCELLED' });
  });

  it('activate after complete → ROOM_TRANSITION_INVALID (REQ-RT-005)', async () => {
    const { room, token } = await orgRoom();
    await roomService.configure(room.id, { appId: 'quiz', manifestVersion: 1, settings: QUIZ_SETTINGS });
    await roomService.activate(room.id, ORG);
    await roomService.complete(room.id, ORG);

    const res = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/activate`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'ROOM_TRANSITION_INVALID' });
  });
});
