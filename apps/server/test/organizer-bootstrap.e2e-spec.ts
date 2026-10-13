import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { tokenResponseSchema } from '@mymozhem/sdk';
import { loadConfig, startTestDb, TEST_CONFIG, TokenService, type TestDb } from '@mymozhem/core';
import { AppModule } from '../src/app.module';
import { HELMET_OPTIONS } from '../src/security-headers';

jest.setTimeout(120_000);

// ADR-012 (T5): POST /auth/organizer — bootstrap единственного организатора по
// setup-токену. Boot зеркалит main.ts (образец — transport.e2e-spec.ts): cookie-плагин
// обязателен (setRefreshCookie пишет mm_refresh), env-override'ы действуют только на
// момент boot — ConfigModule читает process.env один раз, лимитер запечатывает лимит
// в фабрике, после boot env восстанавливается.
const SETUP_TOKEN = 'e2e-organizer-setup-token-0123456789';

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

async function createApp(envOverrides: Record<string, string> = {}): Promise<NestFastifyApplication> {
  const saved: Record<string, string | undefined> = {};
  const env = {
    // Подпись access-токенов тем же секретом, что TEST_CONFIG: спек верифицирует
    // claims вручную сконструированным TokenService (образец transport.e2e-spec).
    JWT_SECRET: TEST_CONFIG.JWT_SECRET,
    ORGANIZER_SETUP_TOKEN: SETUP_TOKEN,
    ...envOverrides,
  };
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    const corsOrigins = loadConfig(process.env).CORS_ORIGINS;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie);
    await app.register(fastifyHelmet, HELMET_OPTIONS);
    await app.register(fastifyCors, { origin: corsOrigins });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  } finally {
    for (const key of Object.keys(env)) restoreEnv(key, saved[key]);
  }
}

const bootstrap = (app: NestFastifyApplication, setupToken: string) =>
  app.inject({ method: 'POST', url: '/auth/organizer', payload: { setupToken } });

describe('POST /auth/organizer (e2e, ADR-012)', () => {
  let db: TestDb;
  let tokens: TokenService;
  let savedDatabaseUrl: string | undefined;

  beforeAll(async () => {
    savedDatabaseUrl = process.env.DATABASE_URL;
    db = await startTestDb(); // выставляет DATABASE_URL — её подхватят app'ы ниже
    tokens = new TokenService(db.prisma, TEST_CONFIG);
  });

  afterAll(async () => {
    await db.stop();
    restoreEnv('DATABASE_URL', savedDatabaseUrl);
  });

  afterEach(async () => {
    // Bootstrap создаёт singleton-identity и сессии; комната — из сценария «полный путь».
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room", identity."Identity" CASCADE');
  });

  describe('happy path и отказы (default limits)', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await createApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('rejects a wrong token: 401 {code: ORGANIZER_SETUP_INVALID}, без куки (REQ-SEC-002/006)', async () => {
      // Токен другой длины — digest-compare не утекает длиной (Review Focus 5);
      // наружу ровно {code}, отказ неразличим для любого mismatch.
      const res = await bootstrap(app, 'wrong');
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ code: 'ORGANIZER_SETUP_INVALID' });
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await db.prisma.identity.count()).toBe(0);
    });

    it('bootstraps: 200, TokenResponse по SDK-схеме, Set-Cookie mm_refresh (Path=/auth, HttpOnly)', async () => {
      const res = await bootstrap(app, SETUP_TOKEN);
      expect(res.statusCode).toBe(200); // пин осознанный (@HttpCode(200), как refresh)
      const body = tokenResponseSchema.parse(res.json());
      const setCookie = res.headers['set-cookie'];
      const cookieHeader = (Array.isArray(setCookie) ? setCookie.join('; ') : setCookie) ?? '';
      expect(cookieHeader).toContain('mm_refresh=');
      expect(cookieHeader).toContain('HttpOnly');
      expect(cookieHeader).toContain('SameSite=Strict');
      expect(cookieHeader).toContain('Path=/auth');
      expect(cookieHeader).not.toContain('Secure'); // e2e не в production
      const claims = tokens.verifyAccessToken(body.accessToken);
      expect(claims.kind).toBe('REGISTERED');
      expect(claims.roomId).toBeUndefined();
      const identity = await db.prisma.identity.findUnique({ where: { id: claims.sub } });
      expect(identity).toMatchObject({ kind: 'REGISTERED', email: null, displayName: 'Организатор' });
    });

    it('second call returns the SAME identity (claims.sub совпадает) и новую токен-пару', async () => {
      const first = await bootstrap(app, SETUP_TOKEN);
      const second = await bootstrap(app, SETUP_TOKEN);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      const firstBody = tokenResponseSchema.parse(first.json());
      const secondBody = tokenResponseSchema.parse(second.json());
      expect(tokens.verifyAccessToken(secondBody.accessToken).sub).toBe(
        tokens.verifyAccessToken(firstBody.accessToken).sub,
      );
      expect(secondBody.accessToken).not.toBe(firstBody.accessToken);
      expect(second.cookies[0].value).not.toBe(first.cookies[0].value);
      expect(
        await db.prisma.identity.count({ where: { kind: 'REGISTERED', deletedAt: null } }),
      ).toBe(1);
    });

    it('bootstrapped organizer creates a room: POST /rooms с access → 201 (полный путь без OAuth)', async () => {
      const boot = await bootstrap(app, SETUP_TOKEN);
      const { accessToken } = tokenResponseSchema.parse(boot.json());
      const res = await app.inject({
        method: 'POST',
        url: '/rooms',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ status: 'DRAFT', joinPolicy: 'guests' });
      expect(typeof res.json().code).toBe('string');
    });
  });

  describe('rate limit (ORGANIZER_RATE_LIMIT=2, REQ-SEC-007)', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await createApp({ ORGANIZER_RATE_LIMIT: '2' });
    });

    afterAll(async () => {
      await app.close();
    });

    it('третий вызов → 429 RATE_LIMITED даже с ВЕРНЫМ токеном: лимитер ДО проверки (нет оракула)', async () => {
      expect((await bootstrap(app, 'wrong-1')).statusCode).toBe(401);
      expect((await bootstrap(app, 'wrong-2')).statusCode).toBe(401);
      const third = await bootstrap(app, SETUP_TOKEN);
      expect(third.statusCode).toBe(429);
      expect(third.json()).toEqual({ code: 'RATE_LIMITED' });
      // Лимит сработал до сверки токена — bootstrap не состоялся.
      expect(await db.prisma.identity.count()).toBe(0);
    });
  });
});
