import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { createRoomResponseSchema, tokenResponseSchema } from '@mymozhem/sdk';
import {
  OAUTH_PKCE_COOKIE,
  OAUTH_PROVIDER_CLIENT,
  OAUTH_REDIRECT_COOKIE,
  OAUTH_STATE_COOKIE,
  REFRESH_COOKIE,
  TEST_CONFIG,
  TokenService,
  loadConfig,
  seedIdentity,
  startTestDb,
  type OAuthProviderClient,
  type ProviderProfile,
  type TestDb,
} from '@mymozhem/core';
import { AppModule } from '../src/app.module';

jest.setTimeout(120_000);

// Организатор комнаты для guest-join кейса — z.uuid() v4-nibble совместимый.
const ORG = '00000000-0000-4000-8000-000000000001';

const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: 'e2e-client-id',
  GOOGLE_CLIENT_SECRET: 'e2e-client-secret',
  OAUTH_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
  OAUTH_REDIRECT_ALLOWLIST: 'http://localhost:3000/app,http://localhost:3000/other',
};

const PROFILE: ProviderProfile = {
  subject: 'google-sub-1',
  email: 'org@example.test',
  emailVerified: true,
  displayName: 'Org',
};

const OAUTH_COOKIES = [OAUTH_STATE_COOKIE, OAUTH_PKCE_COOKIE, OAUTH_REDIRECT_COOKIE] as const;

// Тип ответа inject — через публичную сигнатуру app (fastify не является прямой
// зависимостью apps/server, pnpm его не резолвит из этого пакета).
type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

// Фейк провайдера — override DI-токена (design §9): весь флоу на проводе, сети нет.
// exchangeCode записывает аргументы для ассертов PKCE.
function createFakeProvider(profile: ProviderProfile = PROFILE) {
  return { exchangeCode: jest.fn(async (_code: string, _verifier: string) => profile) };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

// Boot зеркалит main.ts (cookie/helmet/CORS) по паттерну transport.e2e-spec, с двумя
// отличиями: override OAUTH_PROVIDER_CLIENT фейком и env-override со значением
// undefined = удалить ключ (кейс «не сконфигурировано»). Env действует только на
// момент boot: ConfigModule читает process.env один раз, лимитеры запечатывают свои
// значения в фабриках — после boot env восстанавливается.
async function createApp(
  envOverrides: Record<string, string | undefined> = {},
  provider: OAuthProviderClient = createFakeProvider(),
): Promise<NestFastifyApplication> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    saved[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    const corsOrigins = loadConfig(process.env).CORS_ORIGINS;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OAUTH_PROVIDER_CLIENT)
      .useValue(provider)
      .compile();
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

// Сырые set-cookie заголовки одной куки (для ассертов атрибутов).
function setCookiesOf(res: InjectResponse, name: string): string[] {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.filter((h) => h.startsWith(`${name}=`));
}

// Значение куки из ответа (res.cookies — распарсенные set-cookie).
function cookieValueOf(res: InjectResponse, name: string): string {
  const cookie = res.cookies.find((c) => c.name === name);
  expect(cookie).toBeDefined();
  return (cookie as { value: string }).value;
}

// Cookie-заголовок из трёх oauth-кук ответа start — ручная передача между запросами.
function oauthCookieHeader(startRes: InjectResponse): string {
  return OAUTH_COOKIES.map((n) => `${n}=${cookieValueOf(startRes, n)}`).join('; ');
}

// Одноразовость state: куки гасятся при любом исходе callback (design §3) —
// set-cookie с пустым значением и Expires в прошлом.
function expectOAuthCookiesCleared(res: InjectResponse): void {
  for (const name of OAUTH_COOKIES) {
    const headers = setCookiesOf(res, name);
    expect(headers.length).toBeGreaterThan(0);
    expect(headers[0]).toMatch(new RegExp(`^${name}=;`));
    expect(headers[0]).toContain('Expires=Thu, 01 Jan 1970');
  }
}

// start → callback до 302 (без ассертов тела — их делают кейсы). Возвращает оба
// ответа и state для последующих шагов.
async function runFlow(
  app: NestFastifyApplication,
  redirect = 'http://localhost:3000/app',
): Promise<{ startRes: InjectResponse; cbRes: InjectResponse; state: string }> {
  const startRes = await app.inject({
    method: 'GET',
    url: `/auth/google?redirect=${encodeURIComponent(redirect)}`,
  });
  expect(startRes.statusCode).toBe(302);
  const location = startRes.headers.location as string;
  const state = new URL(location).searchParams.get('state');
  expect(state).toBeTruthy();
  const cbRes = await app.inject({
    method: 'GET',
    url: `/auth/google/callback?code=fake-code&state=${state as string}`,
    headers: { cookie: oauthCookieHeader(startRes) },
  });
  return { startRes, cbRes, state: state as string };
}

// refresh по mm_refresh из callback-ответа → access claims через TokenService
// приложения (jsonwebtoken в apps/server не импортируется).
async function refreshAndDecode(app: NestFastifyApplication, cbRes: InjectResponse) {
  const refRes = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: { cookie: `${REFRESH_COOKIE}=${cookieValueOf(cbRes, REFRESH_COOKIE)}` },
  });
  expect(refRes.statusCode).toBe(200);
  const body = tokenResponseSchema.parse(refRes.json());
  const claims = app.get(TokenService).verifyAccessToken(body.accessToken);
  return { body, claims };
}

describe('oauth e2e (на проводе)', () => {
  let db: TestDb;
  let savedDatabaseUrl: string | undefined;
  let savedJwtSecret: string | undefined;

  beforeAll(async () => {
    savedDatabaseUrl = process.env.DATABASE_URL;
    savedJwtSecret = process.env.JWT_SECRET;
    db = await startTestDb(); // выставляет DATABASE_URL — её подхватят app'ы ниже
    // JWT_SECRET обязателен конфигом (REQ-SEC-002); access верифицируется тем же
    // секретом, которым подписывают boot'нутые app'ы.
    process.env.JWT_SECRET = TEST_CONFIG.JWT_SECRET;
  });

  afterAll(async () => {
    await db.stop();
    restoreEnv('DATABASE_URL', savedDatabaseUrl);
    restoreEnv('JWT_SECRET', savedJwtSecret);
  });

  afterEach(async () => {
    // Полная очистка между кейсами: Identity CASCADE тянет Session/IdentityProvider/
    // Membership/Room — ни один кейс не зависит от посева другого.
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE identity."Identity", room."Room" CASCADE');
  });

  describe('полный флоу и негативные (Google сконфигурирован)', () => {
    let app: NestFastifyApplication;
    const exchangeCode = jest.fn(
      async (_code: string, _verifier: string): Promise<ProviderProfile> => PROFILE,
    );

    beforeAll(async () => {
      // OAUTH_RATE_LIMIT поднят до 50 осознанно: лимитер — per-IP и накапливает
      // все start/callback кейсов describe'а (их > 10, дефолт §4). Само поведение
      // rate-limit проверяется отдельным describe с лимитом 2 (REQ-SEC-007).
      app = await createApp({ ...GOOGLE_ENV, OAUTH_RATE_LIMIT: '50' }, { exchangeCode });
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      exchangeCode.mockReset();
      exchangeCode.mockResolvedValue(PROFILE);
    });

    it('полный флоу: start → callback → refresh → POST /rooms (критерий среза, REQ-ID-015/005)', async () => {
      const { startRes, cbRes } = await runFlow(app);

      // --- start: 302 на Google с PKCE S256 + три httpOnly-куки ---
      const location = startRes.headers.location as string;
      expect(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);
      expect(location).toContain('client_id=e2e-client-id');
      expect(location).toContain('code_challenge_method=S256');
      for (const name of OAUTH_COOKIES) {
        const headers = setCookiesOf(startRes, name);
        expect(headers).toHaveLength(1);
        expect(headers[0]).toContain('HttpOnly');
        expect(headers[0]).toContain('Path=/auth');
        expect(headers[0]).toContain('SameSite=Lax'); // Lax: возврат с Google — top-level GET
        expect(headers[0]).not.toContain('Secure'); // e2e не в production
      }

      // --- callback: 302 на allowlisted redirect + refresh-кука без guest-cap ---
      expect(cbRes.statusCode).toBe(302);
      expect(cbRes.headers.location).toBe('http://localhost:3000/app');
      const refreshHeaders = setCookiesOf(cbRes, REFRESH_COOKIE);
      expect(refreshHeaders).toHaveLength(1);
      expect(refreshHeaders[0]).toContain('HttpOnly');
      expect(refreshHeaders[0]).toContain('SameSite=Strict');
      expect(refreshHeaders[0]).toContain('Path=/auth');
      expect(refreshHeaders[0]).not.toContain('Secure');
      const maxAge = Number(/Max-Age=(\d+)/.exec(refreshHeaders[0])?.[1]);
      // REGISTERED — без guest-cap: maxAge ≈ REFRESH_TOKEN_TTL (30 сут), допуск ±5 с.
      expect(maxAge).toBeGreaterThanOrEqual(2_592_000 - 5);
      expect(maxAge).toBeLessThanOrEqual(2_592_000 + 5);
      // Одноразовость state: oauth-куки очищены.
      expectOAuthCookiesCleared(cbRes);

      // --- PKCE: провайдер получил verifier ровно из mm_oauth_pkce ---
      expect(exchangeCode).toHaveBeenCalledTimes(1);
      expect(exchangeCode).toHaveBeenCalledWith('fake-code', cookieValueOf(startRes, OAUTH_PKCE_COOKIE));

      // --- refresh → access: kind REGISTERED, без roomId ---
      const { body: tokenBody, claims } = await refreshAndDecode(app, cbRes);
      expect(claims.kind).toBe('REGISTERED');
      expect(claims.roomId).toBeUndefined();

      // Провижининг на проводе: identity создана по provider-профилю.
      const identity = await db.prisma.identity.findUnique({
        where: { id: claims.sub },
        include: { providers: true },
      });
      expect(identity?.kind).toBe('REGISTERED');
      expect(identity?.email).toBe('org@example.test');
      expect(identity?.providers).toHaveLength(1);
      expect(identity?.providers[0]).toMatchObject({ provider: 'google', subject: 'google-sub-1' });

      // --- POST /rooms: 201, SDK-валидное тело, владелец — identity из access-sub ---
      const roomsRes = await app.inject({
        method: 'POST',
        url: '/rooms',
        headers: { authorization: `Bearer ${tokenBody.accessToken}` },
        payload: {},
      });
      expect(roomsRes.statusCode).toBe(201); // Nest default для POST — пин осознанный
      const roomBody = createRoomResponseSchema.parse(roomsRes.json());
      expect(roomBody.joinPolicy).toBe('guests'); // дефолт REQ-ID-002
      expect(roomBody.status).toBe('DRAFT');
      expect(roomBody.code.length).toBeGreaterThanOrEqual(8);
      const room = await db.prisma.room.findUnique({ where: { id: roomBody.roomId } });
      expect(room?.organizerId).toBe(claims.sub);
    });

    it('повторный логин — та же identity (find-or-create по provider+subject)', async () => {
      const first = await runFlow(app);
      expect(first.cbRes.statusCode).toBe(302);
      const second = await runFlow(app);
      expect(second.cbRes.statusCode).toBe(302);
      const { claims: claims1 } = await refreshAndDecode(app, first.cbRes);
      const { claims: claims2 } = await refreshAndDecode(app, second.cbRes);
      expect(claims2.sub).toBe(claims1.sub);
      expect(claims2.kind).toBe('REGISTERED');
    });

    it('redirect вне allowlist → 400 ровно {code: OAUTH_REDIRECT_INVALID}', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/auth/google?redirect=${encodeURIComponent('http://evil.test')}`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ code: 'OAUTH_REDIRECT_INVALID' });
    });

    it('state mismatch → 401 OAUTH_STATE_INVALID; oauth-куки очищены (одноразовость)', async () => {
      const startRes = await app.inject({
        method: 'GET',
        url: `/auth/google?redirect=${encodeURIComponent('http://localhost:3000/app')}`,
      });
      expect(startRes.statusCode).toBe(302);
      const res = await app.inject({
        method: 'GET',
        url: '/auth/google/callback?code=fake-code&state=forged-state',
        headers: { cookie: oauthCookieHeader(startRes) },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ code: 'OAUTH_STATE_INVALID' });
      expectOAuthCookiesCleared(res);
    });

    it('нет state-куки → 401 OAUTH_STATE_INVALID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/google/callback?code=fake-code&state=whatever',
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ code: 'OAUTH_STATE_INVALID' });
    });

    it('error=access_denied → 403 OAUTH_ACCESS_DENIED', async () => {
      const res = await app.inject({ method: 'GET', url: '/auth/google/callback?error=access_denied' });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: 'OAUTH_ACCESS_DENIED' });
    });

    it('exchange бросает → 502 OAUTH_EXCHANGE_FAILED; oauth-куки очищены', async () => {
      exchangeCode.mockRejectedValueOnce(new Error('provider down'));
      const startRes = await app.inject({
        method: 'GET',
        url: `/auth/google?redirect=${encodeURIComponent('http://localhost:3000/app')}`,
      });
      const state = new URL(startRes.headers.location as string).searchParams.get('state');
      const res = await app.inject({
        method: 'GET',
        url: `/auth/google/callback?code=fake-code&state=${state as string}`,
        headers: { cookie: oauthCookieHeader(startRes) },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ code: 'OAUTH_EXCHANGE_FAILED' });
      expectOAuthCookiesCleared(res);
    });

    it('emailVerified: false → 403 OAUTH_EMAIL_UNVERIFIED', async () => {
      exchangeCode.mockResolvedValueOnce({ ...PROFILE, emailVerified: false });
      const { cbRes } = await runFlow(app);
      expect(cbRes.statusCode).toBe(403);
      expect(cbRes.json()).toEqual({ code: 'OAUTH_EMAIL_UNVERIFIED' });
    });

    it('email занят другой REGISTERED-identity → 409 OAUTH_EMAIL_CONFLICT', async () => {
      await seedIdentity(db.prisma, { kind: 'REGISTERED', email: 'org@example.test' });
      // Другой subject (первый логин этого Google-аккаунта), тот же email — конфликт.
      exchangeCode.mockResolvedValueOnce({ ...PROFILE, subject: 'google-sub-conflict' });
      const { cbRes } = await runFlow(app);
      expect(cbRes.statusCode).toBe(409);
      expect(cbRes.json()).toEqual({ code: 'OAUTH_EMAIL_CONFLICT' });
      // Конфликт не создал identity: в БД ровно одна — посеянная.
      expect(await db.prisma.identity.count()).toBe(1);
    });

    it('POST /rooms с GUEST-токеном → 403 ровно {code: ROOM_ORGANIZER_NOT_REGISTERED}', async () => {
      await seedIdentity(db.prisma, { id: ORG });
      const room = await db.prisma.room.create({ data: { organizerId: ORG, code: 'E2ECASE11' } });
      const joinRes = await app.inject({
        method: 'POST',
        url: '/rooms/join',
        payload: { code: room.code, displayName: 'Гость' },
      });
      expect(joinRes.statusCode).toBe(201);
      const { accessToken } = tokenResponseSchema.parse(joinRes.json());
      const res = await app.inject({
        method: 'POST',
        url: '/rooms',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: 'ROOM_ORGANIZER_NOT_REGISTERED' });
    });

    it('POST /rooms без токена → 401 ровно {code: SESSION_INVALID}', async () => {
      const res = await app.inject({ method: 'POST', url: '/rooms', payload: {} });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ code: 'SESSION_INVALID' });
    });

    it("POST /rooms с joinPolicy 'invite_only' → 201; лишний ключ → 400 REQUEST_INVALID", async () => {
      const { cbRes } = await runFlow(app);
      expect(cbRes.statusCode).toBe(302);
      const { body: tokenBody } = await refreshAndDecode(app, cbRes);
      const auth = { authorization: `Bearer ${tokenBody.accessToken}` };

      const created = await app.inject({
        method: 'POST',
        url: '/rooms',
        headers: auth,
        payload: { joinPolicy: 'invite_only' },
      });
      expect(created.statusCode).toBe(201);
      const body = createRoomResponseSchema.parse(created.json());
      expect(body.joinPolicy).toBe('invite_only');
      expect(body.status).toBe('DRAFT');

      const extra = await app.inject({
        method: 'POST',
        url: '/rooms',
        headers: auth,
        payload: { joinPolicy: 'guests', extra: true },
      });
      expect(extra.statusCode).toBe(400);
      expect(extra.json()).toEqual({ code: 'REQUEST_INVALID' });
    });

    it('негативные ответы несут ровно {code} — без message/stack (REQ-SEC-006 на проводе)', async () => {
      const responses: InjectResponse[] = [
        await app.inject({ method: 'GET', url: '/auth/google/callback?code=x&state=y' }), // 401
        await app.inject({
          method: 'GET',
          url: `/auth/google?redirect=${encodeURIComponent('http://evil.test')}`,
        }), // 400
        await app.inject({ method: 'GET', url: '/auth/google/callback?error=access_denied' }), // 403
        await app.inject({ method: 'POST', url: '/rooms', payload: {} }), // 401
        await app.inject({
          method: 'POST',
          url: '/rooms/join',
          payload: { code: 'zzzzzzzz', displayName: 'A' },
        }), // 403
      ];
      for (const res of responses) {
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(Object.keys(res.json() as object)).toEqual(['code']);
        expect(res.body).not.toContain('message');
        expect(res.body).not.toContain('stack');
      }
    });
  });

  describe('rate-limit callback (OAUTH_RATE_LIMIT=2, REQ-SEC-007)', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await createApp({ ...GOOGLE_ENV, OAUTH_RATE_LIMIT: '2' });
    });

    afterAll(async () => {
      await app.close();
    });

    it('третий callback с одного IP → 429 ровно {code: RATE_LIMITED}', async () => {
      const cb = () =>
        app.inject({ method: 'GET', url: '/auth/google/callback?code=x&state=y' });
      // Лимитер стоит ДО схемы/сервиса: первые два доходят до домена (401 по state)…
      expect((await cb()).statusCode).toBe(401);
      expect((await cb()).statusCode).toBe(401);
      // …третий отброшен по IP.
      const third = await cb();
      expect(third.statusCode).toBe(429);
      expect(third.json()).toEqual({ code: 'RATE_LIMITED' });
    });
  });

  describe('Google не сконфигурирован', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      // undefined = удалить ключ из env на момент boot — hermetic даже если в
      // окружении разработчика выставлены реальные GOOGLE_*.
      app = await createApp({
        GOOGLE_CLIENT_ID: undefined,
        GOOGLE_CLIENT_SECRET: undefined,
        OAUTH_REDIRECT_URI: undefined,
        OAUTH_REDIRECT_ALLOWLIST: undefined,
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('GET /auth/google → 503 ровно {code: OAUTH_NOT_CONFIGURED}', async () => {
      const res = await app.inject({ method: 'GET', url: '/auth/google' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ code: 'OAUTH_NOT_CONFIGURED' });
    });

    it('GET /auth/google/callback → 503 OAUTH_NOT_CONFIGURED', async () => {
      const res = await app.inject({ method: 'GET', url: '/auth/google/callback?code=x&state=y' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ code: 'OAUTH_NOT_CONFIGURED' });
    });
  });
});
