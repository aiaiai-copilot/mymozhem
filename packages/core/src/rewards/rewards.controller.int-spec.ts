import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { APP_FILTER } from '@nestjs/core';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { AppRuntimeModule } from '../app-runtime/app-runtime.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG } from '../config/config.tokens';
import { MembershipModule } from '../membership/membership.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { HttpExceptionFilter } from '../transport/http-exception.filter';
import { TokenService } from '../auth/token.service';
import { RoomService } from '../room/room.service';
import { RoomModule } from '../room/room.module';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { TEST_CONFIG } from '../testing/test-config';
import { RewardsModule } from './rewards.module';
import { RewardsService } from './rewards.service';

// HTTP-путь REST-контура rewards (design 2026-09-10 §2): контроллер → сервис →
// фильтр, статусы/тела проверяются на границе (REQ-SEC-006: наружу ровно {code}).
// Комната остаётся DRAFT: createPrize принимает DRAFT, fulfill/revoke/listAwards
// статус комнаты не гейтят вообще (activate требует configure, REQ-RT-004).
describe('RewardsController (int)', () => {
  let db: TestDb;
  let app: NestFastifyApplication;
  let tokens: TokenService;
  let roomService: RoomService;
  let rewards: RewardsService;

  const ORG = '00000000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    db = await startTestDb();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        PrismaModule,
        AppRegistryModule.register([]),
        // RealtimeGateway (провайдер RealtimeModule) разрешает AppRuntimeService
        // через global-провайдер — без register DI не собирается.
        AppRuntimeModule.register([]),
        AuthModule,
        MembershipModule,
        RealtimeModule,
        RoomModule,
        RewardsModule,
      ],
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
    rewards = app.get(RewardsService);
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE realtime."LogEvent", rewards."Award", rewards."Prize", identity."Session", membership."Membership", room."Room" CASCADE',
    );
  });

  // organizerToken — guest-claims, роль ORGANIZER из membership (прецедент
  // transport.e2e-spec.ts exclude-сьюта).
  async function orgRoom() {
    const room = await roomService.create(ORG);
    const { accessToken } = await tokens.issueGuestTokens(ORG, room.id);
    return { room, token: accessToken };
  }
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it('POST /rooms/:id/prizes → 201; повтор для PARTICIPANT → 403 ACTOR_NOT_ORGANIZER; невалидное тело → 400 REQUEST_INVALID', async () => {
    const { room, token } = await orgRoom();
    const created = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/prizes`,
      headers: auth(token),
      payload: { name: 'Приз', quantity: 2 },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Приз', quantity: 2, quantityTotal: 2 });

    const bad = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/prizes`,
      headers: auth(token),
      payload: { name: '', quantity: 0 },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ code: 'REQUEST_INVALID' });

    const guest = await seedIdentity(db.prisma, { kind: 'GUEST' });
    await db.prisma.membership.create({
      data: { roomId: room.id, identityId: guest.id, role: 'PARTICIPANT', joinIp: '127.0.0.1' },
    });
    const guestToken = (await tokens.issueGuestTokens(guest.id, room.id)).accessToken;
    const forbidden = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/prizes`,
      headers: auth(guestToken),
      payload: { name: 'Приз', quantity: 1 },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ code: 'ACTOR_NOT_ORGANIZER' });
  });

  it('fulfill/revoke по HTTP: no-op повторного вручения → 200, cross-переход → 409 REWARD_ALREADY_RESOLVED, чужая награда → 404', async () => {
    const { room, token } = await orgRoom();
    const prize = await rewards.createPrize(room.id, ORG, { name: 'Приз', quantity: 1 });
    const winner = await seedIdentity(db.prisma, { kind: 'GUEST' });
    const award = await db.prisma.award.create({
      data: { roomId: room.id, prizeId: prize.id, winnerId: winner.id, sourceAppId: 'lottery' },
    });

    const f1 = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/awards/${award.id}/fulfill`,
      headers: auth(token),
    });
    expect(f1.statusCode).toBe(200);
    expect(f1.json()).toMatchObject({ id: award.id, status: 'FULFILLED' });
    // Событие вручения закоммичено в лог комнаты (аудит, ADR-005) — прямая проверка.
    await expect(
      db.prisma.logEvent.findFirst({ where: { roomId: room.id, type: 'rewards.reward.fulfilled' } }),
    ).resolves.not.toBeNull();

    const f2 = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/awards/${award.id}/fulfill`,
      headers: auth(token),
    });
    expect(f2.statusCode).toBe(200); // типизированный no-op
    const cross = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/awards/${award.id}/revoke`,
      headers: auth(token),
    });
    expect(cross.statusCode).toBe(409);
    expect(cross.json()).toEqual({ code: 'REWARD_ALREADY_RESOLVED' });
    const missing = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/awards/${crypto.randomUUID()}/fulfill`,
      headers: auth(token),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'AWARD_UNKNOWN' });

    const list = await app.inject({
      method: 'GET',
      url: `/rooms/${room.id}/rewards`,
      headers: auth(token),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().awards).toHaveLength(1);
  });

  it('без токена → 401 SESSION_INVALID', async () => {
    const { room } = await orgRoom();
    const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}/rewards` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'SESSION_INVALID' });
  });
});
