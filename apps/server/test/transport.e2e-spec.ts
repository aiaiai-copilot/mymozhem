import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { tokenResponseSchema } from '@mymozhem/sdk';
import {
  AppRegistryService,
  EventEmitLimiter,
  EventLogService,
  IdentityService,
  JoinRateLimiter,
  MembershipService,
  RoomService,
  TEST_CONFIG,
  TokenService,
  loadConfig,
  seedIdentity,
  startTestDb,
  type TestDb,
} from '@mymozhem/core';
import { AppModule } from '../src/app.module';

jest.setTimeout(120_000);

const ORG = '00000000-0000-0000-0000-000000000001';

// Тип ответа inject — через публичную сигнатуру app (fastify не является прямой
// зависимостью apps/server, pnpm его не резолвит из этого пакета).
type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

// Boot зеркалит main.ts: cookie-плагин обязателен (refresh читает req.cookies),
// helmet/CORS — REQ-SEC-008. Env-override'ы действуют только на момент boot:
// ConfigModule читает process.env один раз при инициализации модуля, лимитеры
// запечатывают свои значения в фабриках — после boot env можно восстановить.
async function createApp(envOverrides: Record<string, string> = {}): Promise<NestFastifyApplication> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    const corsOrigins = loadConfig(process.env).CORS_ORIGINS;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie);
    await app.register(fastifyHelmet);
    await app.register(fastifyCors, { origin: corsOrigins });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  } finally {
    for (const key of Object.keys(envOverrides)) restoreEnv(key, saved[key]);
  }
}

const join = (
  app: NestFastifyApplication,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
) => app.inject({ method: 'POST', url: '/rooms/join', payload, headers });

const refresh = (app: NestFastifyApplication, cookie?: string) =>
  app.inject({ method: 'POST', url: '/auth/refresh', headers: cookie ? { cookie } : {} });

// Кука между запросами передаётся вручную: res.cookies → заголовок cookie.
function refreshCookieOf(res: InjectResponse): string {
  const cookie = res.cookies.find((c) => c.name === 'mm_refresh');
  expect(cookie).toBeDefined();
  return `mm_refresh=${(cookie as { value: string }).value}`;
}

describe('Transport HTTP (e2e)', () => {
  let db: TestDb;
  let roomService: RoomService;
  let tokens: TokenService;
  let savedDatabaseUrl: string | undefined;
  let savedJwtSecret: string | undefined;

  beforeAll(async () => {
    savedDatabaseUrl = process.env.DATABASE_URL;
    savedJwtSecret = process.env.JWT_SECRET;
    db = await startTestDb(); // выставляет DATABASE_URL — её подхватят app'ы ниже
    // Access-токены верифицируем тем же секретом, которым подписывают boot'нутые app'ы.
    process.env.JWT_SECRET = TEST_CONFIG.JWT_SECRET;
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    // Посев комнат — через core-сервисы, сконструированные вручную (как в int-спеках).
    roomService = new RoomService(
      db.prisma,
      new EventLogService(
        new AppRegistryService([]),
        new EventEmitLimiter(1000),
        TEST_CONFIG,
      ),
      new AppRegistryService([]),
      new MembershipService(
        db.prisma,
        new IdentityService(db.prisma),
        new JoinRateLimiter(1000),
        TEST_CONFIG,
      ),
      TEST_CONFIG,
    );
    tokens = new TokenService(db.prisma, TEST_CONFIG);
  });

  afterAll(async () => {
    await db.stop();
    restoreEnv('DATABASE_URL', savedDatabaseUrl);
    restoreEnv('JWT_SECRET', savedJwtSecret);
  });

  afterEach(async () => {
    // identity."Identity" НЕ трогаем — ORG посеян один раз на файл.
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE identity."Session", membership."Membership", room."Room" CASCADE',
    );
  });

  describe('default limits', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await createApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('join happy path: 201, SDK-валидное тело, refresh-кука, access claims', async () => {
      const room = await roomService.create(ORG);
      const res = await join(app, { code: room.code, displayName: 'Саша' });
      expect(res.statusCode).toBe(201); // Nest default для POST — пин осознанный
      // Тело валидно по SDK-схеме — контракт на проводе (REQ-SEC-006, REQ-ID-016).
      const body = tokenResponseSchema.parse(res.json());
      // REQ-ID-008: refresh живёт только в httpOnly-куке, не в теле.
      const setCookie = res.headers['set-cookie'];
      const cookieHeader = (Array.isArray(setCookie) ? setCookie.join('; ') : setCookie) ?? '';
      expect(cookieHeader).toContain('mm_refresh=');
      expect(cookieHeader).toContain('HttpOnly');
      expect(cookieHeader).toContain('SameSite=Strict');
      expect(cookieHeader).toContain('Path=/auth');
      // Secure — только в production; e2e гоняется не в production → флага нет.
      expect(cookieHeader).not.toContain('Secure');
      const claims = tokens.verifyAccessToken(body.accessToken);
      expect(claims).toMatchObject({ kind: 'GUEST', roomId: room.id });
    });

    it('неверный код → 403 ровно {code: ROOM_JOIN_DENIED} (REQ-SEC-006)', async () => {
      const res = await join(app, { code: 'zzzzzzzz', displayName: 'A' });
      expect(res.statusCode).toBe(403);
      // Ровно {code}: ни message, ни stack — toEqual ловит лишние ключи.
      expect(res.json()).toEqual({ code: 'ROOM_JOIN_DENIED' });
    });

    it('закрытая политика (registered) → ответ идентичен неверному коду (REQ-ID-013)', async () => {
      const room = await roomService.create(ORG);
      await db.prisma.room.update({ where: { id: room.id }, data: { joinPolicy: 'REGISTERED' } });
      const resWrong = await join(app, { code: 'zzzzzzzz', displayName: 'A' });
      const resClosed = await join(app, { code: room.code, displayName: 'A' });
      // Неразличимость на проводе: статус и тело — байт-в-байт.
      expect(resClosed.statusCode).toBe(resWrong.statusCode);
      expect(resClosed.body).toBe(resWrong.body);
    });

    it('невалидное тело → 400 {code: REQUEST_INVALID}', async () => {
      const res = await join(app, { code: 'ABCDEFGH' }); // нет displayName
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ code: 'REQUEST_INVALID' });
    });

    it('refresh happy: ротация; повтор старого → 401 и ревок всего семейства (REQ-ID-007)', async () => {
      const room = await roomService.create(ORG);
      const joinRes = await join(app, { code: room.code, displayName: 'Гость' });
      expect(joinRes.statusCode).toBe(201);
      const oldCookie = refreshCookieOf(joinRes);

      const rotated = await refresh(app, oldCookie);
      expect(rotated.statusCode).toBe(200); // пин осознанный (@HttpCode(200))
      tokenResponseSchema.parse(rotated.json());
      const newCookie = refreshCookieOf(rotated);
      expect(newCookie).not.toBe(oldCookie);

      // Предъявление уже ротированного токена — сигнал кражи: SESSION_INVALID…
      const reuse = await refresh(app, oldCookie);
      expect(reuse.statusCode).toBe(401);
      expect(reuse.json()).toEqual({ code: 'SESSION_INVALID' });
      // …и ревок семейства: НОВЫЙ refresh после reuse тоже мёртв.
      const afterRevoke = await refresh(app, newCookie);
      expect(afterRevoke.statusCode).toBe(401);
      expect(afterRevoke.json()).toEqual({ code: 'SESSION_INVALID' });
    });

    it('refresh без куки → 401 {code: SESSION_INVALID}', async () => {
      const res = await refresh(app);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ code: 'SESSION_INVALID' });
    });

    it('helmet: ответ join содержит security-заголовки (REQ-SEC-008)', async () => {
      const room = await roomService.create(ORG);
      const res = await join(app, { code: room.code, displayName: 'A' });
      expect(res.statusCode).toBe(201);
      expect(res.headers['x-dns-prefetch-control']).toBe('off');
    });

    it('терминальная комната: refresh → 401 (REQ-ID-016 на проводе)', async () => {
      const room = await roomService.create(ORG);
      const joinRes = await join(app, { code: room.code, displayName: 'A' });
      expect(joinRes.statusCode).toBe(201);
      // DRAFT → CANCELLED — единственный сервисный терминальный переход из DRAFT
      // (DRAFT → COMPLETED нет в ROOM_TRANSITIONS); rotate проверяет оба статуса.
      await roomService.cancel(room.id);
      const res = await refresh(app, refreshCookieOf(joinRes));
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ code: 'SESSION_INVALID' });
    });
  });

  describe('join rate limit (JOIN_RATE_LIMIT_IP=2)', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await createApp({ JOIN_RATE_LIMIT_IP: '2' });
    });

    afterAll(async () => {
      await app.close();
    });

    it('третий join с одного IP → 429 {code: RATE_LIMITED} (REQ-ID-006)', async () => {
      const room = await roomService.create(ORG);
      expect((await join(app, { code: room.code, displayName: 'A' })).statusCode).toBe(201);
      expect((await join(app, { code: room.code, displayName: 'B' })).statusCode).toBe(201);
      const third = await join(app, { code: room.code, displayName: 'C' });
      expect(third.statusCode).toBe(429);
      expect(third.json()).toEqual({ code: 'RATE_LIMITED' });
    });
  });

  describe('participant limit (ROOM_PARTICIPANT_LIMIT=1)', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await createApp({ ROOM_PARTICIPANT_LIMIT: '1' });
    });

    afterAll(async () => {
      await app.close();
    });

    it('второй гость → 409 {code: ROOM_PARTICIPANT_LIMIT_REACHED} (REQ-ID-006)', async () => {
      const room = await roomService.create(ORG);
      expect((await join(app, { code: room.code, displayName: 'A' })).statusCode).toBe(201);
      const second = await join(app, { code: room.code, displayName: 'B' });
      expect(second.statusCode).toBe(409);
      expect(second.json()).toEqual({ code: 'ROOM_PARTICIPANT_LIMIT_REACHED' });
    });
  });

  describe('refresh rate limit (REFRESH_RATE_LIMIT=1)', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await createApp({ REFRESH_RATE_LIMIT: '1' });
    });

    afterAll(async () => {
      await app.close();
    });

    it('второй refresh → 429 {code: RATE_LIMITED} (REQ-SEC-007)', async () => {
      const room = await roomService.create(ORG);
      const joinRes = await join(app, { code: room.code, displayName: 'A' });
      const first = await refresh(app, refreshCookieOf(joinRes));
      expect(first.statusCode).toBe(200);
      // Лимитер стоит ДО любой работы с токеном — второй вызов отброшен по IP.
      const second = await refresh(app, refreshCookieOf(first));
      expect(second.statusCode).toBe(429);
      expect(second.json()).toEqual({ code: 'RATE_LIMITED' });
    });
  });

  describe('CORS (REQ-SEC-008)', () => {
    let appDefault: NestFastifyApplication;
    let appCors: NestFastifyApplication;

    beforeAll(async () => {
      appDefault = await createApp(); // CORS_ORIGINS пуст по умолчанию
      appCors = await createApp({ CORS_ORIGINS: 'https://ok.example' });
    });

    afterAll(async () => {
      await appDefault.close();
      await appCors.close();
    });

    it('origin не из allowlist → нет access-control-allow-origin; из allowlist → есть', async () => {
      const room = await roomService.create(ORG);
      const evil = await join(
        appDefault,
        { code: room.code, displayName: 'A' },
        { origin: 'https://evil.example' },
      );
      expect(evil.statusCode).toBe(201); // CORS не блокирует запрос — не выдаёт заголовки
      expect(evil.headers['access-control-allow-origin']).toBeUndefined();

      const ok = await join(
        appCors,
        { code: room.code, displayName: 'B' },
        { origin: 'https://ok.example' },
      );
      expect(ok.statusCode).toBe(201);
      expect(ok.headers['access-control-allow-origin']).toBe('https://ok.example');
    });
  });
});
