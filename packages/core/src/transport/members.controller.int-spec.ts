import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { APP_FILTER } from '@nestjs/core';
import { validManifests } from '@mymozhem/sdk';
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
import { TEST_CONFIG } from '../testing/test-config';
import { MembersController } from './members.controller';

// GET /rooms/:roomId/members (дизайн UI-среза, решение №10): ростер — любому активному
// члену; swept-гость (TTL-анонимизация identity) остаётся в ростере с displayName null.
// Паттерн — rewards.controller.int-spec.ts.
describe('MembersController (int)', () => {
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
        AppRegistryModule.register([validManifests[0]]),
        // RealtimeGateway (провайдер RealtimeModule) разрешает AppRuntimeService
        // через global-провайдер — без register DI не собирается.
        AppRuntimeModule.register([]),
        AuthModule,
        MembershipModule,
        RealtimeModule,
        RoomModule,
      ],
      controllers: [MembersController],
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

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  // displayName задаётся напрямую строкой identity: seedIdentity-хелпер поля
  // displayName не имеет, а ростер — про него.
  async function seedGuestMember(roomId: string, displayName: string, role: 'PARTICIPANT' | 'SPECTATOR') {
    const identity = await db.prisma.identity.create({ data: { kind: 'GUEST', displayName } });
    await db.prisma.membership.create({
      data: { roomId, identityId: identity.id, role, joinIp: '127.0.0.1' },
    });
    return identity;
  }

  it('roster: organizer+participant+spectator видны всем членам, роли lowercase', async () => {
    const room = await roomService.create(ORG);
    const participant = await seedGuestMember(room.id, 'Петя', 'PARTICIPANT');
    const spectator = await seedGuestMember(room.id, 'Света', 'SPECTATOR');
    // Читаем токеном PARTICIPANT'а: ростер — не organizer-only (решение №10).
    const token = (await tokens.issueGuestTokens(participant.id, room.id)).accessToken;

    const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}/members`, headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().members).toHaveLength(3);
    expect(res.json().members).toEqual(
      expect.arrayContaining([
        { identityId: ORG, displayName: null, role: 'organizer' },
        { identityId: participant.id, displayName: 'Петя', role: 'participant' },
        { identityId: spectator.id, displayName: 'Света', role: 'spectator' },
      ]),
    );
  });

  it('swept guest — displayName null в ростере', async () => {
    const room = await roomService.create(ORG);
    const swept = await seedGuestMember(room.id, 'Был Гость', 'PARTICIPANT');
    // Зеркало строки guest-sweep.service (TTL-анонимизация): displayName/email → null,
    // deletedAt выставлен; membership при этом жива (решение №10).
    await db.prisma.identity.update({
      where: { id: swept.id },
      data: { displayName: null, deletedAt: new Date() },
    });
    const token = (await tokens.issueGuestTokens(ORG, room.id)).accessToken;

    const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}/members`, headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().members).toContainEqual({ identityId: swept.id, displayName: null, role: 'participant' });
  });

  it('non-member (гость другой комнаты) → 403 ACTOR_NOT_MEMBER', async () => {
    const roomA = await roomService.create(ORG);
    const roomB = await roomService.create(ORG);
    const outsider = await seedGuestMember(roomB.id, 'Чужой', 'PARTICIPANT');
    const token = (await tokens.issueGuestTokens(outsider.id, roomB.id)).accessToken;

    const res = await app.inject({ method: 'GET', url: `/rooms/${roomA.id}/members`, headers: auth(token) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: 'ACTOR_NOT_MEMBER' });
  });

  it('no token → 401', async () => {
    const room = await roomService.create(ORG);
    const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}/members` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'SESSION_INVALID' });
  });
});
