### Task 2: e2e exclusion/rate-limit через XFF (автоматика A1)

**Закрывает:** REQ-ID-006 (per-IP семантика exclusion и join rate-limit); дизайн §8.1. Страж класса №7 в обычном CI.

**Files:**
- Test: `apps/server/test/xff-forwarded-for.e2e-spec.ts` (создать)

**Interfaces:**
- Consumes: паттерны `apps/server/test/transport.e2e-spec.ts` (createApp, seed ORG, ручная сборка RoomService, TRUNCATE), `joinResponseSchema` из SDK, `JoinRateLimiter` (лимит из `JOIN_RATE_LIMIT_IP`).
- Produces: ничего для других задач.

- [ ] **Step 1: Падающий e2e — exclusion per-IP**

Создать файл целиком (комментарии объясняют отличия от transport.e2e-spec):

```ts
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { joinResponseSchema } from '@mymozhem/sdk';
import {
  AppRegistryService,
  EventEmitLimiter,
  EventLogService,
  EventOutbox,
  IdentityService,
  JoinRateLimiter,
  MembershipService,
  MetricsService,
  RealtimeBus,
  RoomService,
  TEST_CONFIG,
  TokenService,
  fakeLogger,
  seedIdentity,
  startTestDb,
  type TestDb,
} from '@mymozhem/core';
import { AppModule } from '../src/app.module';

jest.setTimeout(120_000);

// Находка №7 (дизайн §8.1): на compose-стенде docker NAT показывает всех клиентов
// под IP gateway'я — exclusion банит всех, rate-limit общий. На событие сервер
// идёт bare-run (чеклист §0.4), а этот сьют запирает серверную логику «чей IP»:
// при trustProxy=true req.ip приходит из X-Forwarded-For, без него XFF игнорируется
// (main.ts: FastifyAdapter({trustProxy: config.TRUST_PROXY})).
// Helmet/CORS не регистрируем: join/exclude от них не зависят, boot легче.

const ORG = '00000000-0000-4000-8000-000000000001';

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

// В отличие от transport.e2e-spec адаптер получает trustProxy ЯВНО — это и есть
// управляемая переменная сьюта (main.ts читает её из конфига, здесь — из opts).
async function createApp(
  opts: { trustProxy: boolean },
  envOverrides: Record<string, string> = {},
): Promise<NestFastifyApplication> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy: opts.trustProxy }),
    );
    await app.register(fastifyCookie);
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

const exclude = (app: NestFastifyApplication, roomId: string, identityId: string, token: string) =>
  app.inject({
    method: 'POST',
    url: `/rooms/${roomId}/members/${identityId}/exclude`,
    headers: { authorization: `Bearer ${token}` },
  });

describe('X-Forwarded-For (e2e, REQ-ID-006 per-IP семантика)', () => {
  let db: TestDb;
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
    // Комнаты — через core-сервисы вручную (тот же приём, что transport.e2e).
    const outbox = new EventOutbox(db.prisma, new RealtimeBus(), new MetricsService());
    roomService = new RoomService(
      db.prisma,
      new EventLogService(new AppRegistryService([]), new EventEmitLimiter(1000), TEST_CONFIG, outbox),
      outbox,
      new AppRegistryService([]),
      new MembershipService(db.prisma, new IdentityService(db.prisma), new JoinRateLimiter(1000), TEST_CONFIG, fakeLogger),
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
    // identity."Identity" не трогаем — ORG посеян один раз на файл.
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE identity."Session", membership."Membership", room."Room" CASCADE',
    );
  });

  // guest-claims + роль ORGANIZER из membership — как в transport.e2e.
  async function organizerToken(roomId: string): Promise<string> {
    return (await tokens.issueGuestTokens(ORG, roomId)).accessToken;
  }

  describe('trustProxy=true', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await createApp({ trustProxy: true });
    });
    afterAll(async () => {
      await app.close();
    });

    it('exclusion по IP банит только IP нарушителя (класс №7)', async () => {
      const room = await roomService.create(ORG);
      const ipA = { 'x-forwarded-for': '203.0.113.10' }; // TEST-NET-3
      const joinA = await join(app, { code: room.code, displayName: 'A' }, ipA);
      expect(joinA.statusCode).toBe(201);
      expect(
        (await join(app, { code: room.code, displayName: 'B' }, { 'x-forwarded-for': '203.0.113.20' })).statusCode,
      ).toBe(201);

      const guestA = tokens.verifyAccessToken(joinResponseSchema.parse(joinA.json()).accessToken).sub;
      const res = await exclude(app, room.id, guestA, await organizerToken(room.id));
      expect(res.statusCode).toBe(200);

      // Перезаход нарушителя с того же IP — отказ.
      const rejoinA = await join(app, { code: room.code, displayName: 'A2' }, ipA);
      expect(rejoinA.statusCode).toBe(403);
      expect(rejoinA.json()).toEqual({ code: 'ROOM_JOIN_DENIED' });

      // Другой IP — вход свободен: бан НЕ общий (регрессия №7 была бы 403 и здесь).
      const joinC = await join(app, { code: room.code, displayName: 'C' }, { 'x-forwarded-for': '203.0.113.30' });
      expect(joinC.statusCode).toBe(201);
    });
  });

  describe('trustProxy=true, JOIN_RATE_LIMIT_IP=2', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await createApp({ trustProxy: true }, { JOIN_RATE_LIMIT_IP: '2' });
    });
    afterAll(async () => {
      await app.close();
    });

    it('join rate-limit считается per-XFF-IP, касса не общая (класс №7)', async () => {
      const room = await roomService.create(ORG);
      const ipA = { 'x-forwarded-for': '198.51.100.10' }; // TEST-NET-2
      expect((await join(app, { code: room.code, displayName: 'A1' }, ipA)).statusCode).toBe(201);
      expect((await join(app, { code: room.code, displayName: 'A2' }, ipA)).statusCode).toBe(201);
      const third = await join(app, { code: room.code, displayName: 'A3' }, ipA);
      expect(third.statusCode).toBe(429);
      expect(third.json()).toEqual({ code: 'RATE_LIMITED' });

      // Другой IP — своя касса.
      expect(
        (await join(app, { code: room.code, displayName: 'B1' }, { 'x-forwarded-for': '198.51.100.20' })).statusCode,
      ).toBe(201);
    });
  });

  describe('trustProxy=false (дефолт), JOIN_RATE_LIMIT_IP=2', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await createApp({ trustProxy: false }, { JOIN_RATE_LIMIT_IP: '2' });
    });
    afterAll(async () => {
      await app.close();
    });

    it('XFF игнорируется: лимит общий на peer (fail-closed пин main.ts)', async () => {
      const room = await roomService.create(ORG);
      expect(
        (await join(app, { code: room.code, displayName: 'A' }, { 'x-forwarded-for': '198.51.100.10' })).statusCode,
      ).toBe(201);
      expect(
        (await join(app, { code: room.code, displayName: 'B' }, { 'x-forwarded-for': '198.51.100.20' })).statusCode,
      ).toBe(201);
      // Оба входа посчитаны на peer inject'а: третий — 429 независимо от XFF.
      const third = await join(app, { code: room.code, displayName: 'C' }, { 'x-forwarded-for': '198.51.100.30' });
      expect(third.statusCode).toBe(429);
    });
  });
});
```

- [ ] **Step 2: Прогнать — наблюдать результат**

Run: `pnpm --filter @mymozhem/server test -- xff-forwarded-for`
Expected: сьют зелёный СРАЗУ — это характеризационный страж: логика per-IP уже корректна, дефект №7 был топологией (NAT), а не кодом. Если какой-то кейс красный — это реальная находка, СТОП и разбор до продолжения (возможно, задета серверная логика — эскалация владельцу).

- [ ] **Step 3: Характеризация многоадресного XFF (Review Focus 3)**

Добавить в describe `trustProxy=true`:

```ts
    it('цепочка XFF: exclusion консистентен с тем адресом, который видит req.ip', async () => {
      const room = await roomService.create(ORG);
      // Клиент за NAT/прокси: цепочка «клиент, прокси». Семантика выбора адреса —
      // fastify/proxy-addr (доверенные сбрасываются справа); тест пинит, что
      // exclusion и повторный join видят ОДИН адрес, какой бы он ни был.
      const chain = { 'x-forwarded-for': '203.0.113.40, 10.0.0.1' };
      const joinA = await join(app, { code: room.code, displayName: 'A' }, chain);
      expect(joinA.statusCode).toBe(201);
      const guestA = tokens.verifyAccessToken(joinResponseSchema.parse(joinA.json()).accessToken).sub;
      expect((await exclude(app, room.id, guestA, await organizerToken(room.id))).statusCode).toBe(200);

      // Та же цепочка — отказ (тот же req.ip → тот же joinIp в Exclusion).
      const rejoinSameChain = await join(app, { code: room.code, displayName: 'A2' }, chain);
      expect(rejoinSameChain.statusCode).toBe(403);

      // Какой именно адрес выбран — проверяем эмпирически один раз: ровно один
      // из двух одиночных заголовков обязан быть забанен. Пиним фактический в
      // комментарии после первого прогона (ожидается крайний левый, клиентский).
      const only40 = await join(app, { code: room.code, displayName: 'A3' }, { 'x-forwarded-for': '203.0.113.40' });
      const only10 = await join(app, { code: room.code, displayName: 'A4' }, { 'x-forwarded-for': '10.0.0.1' });
      expect([only40.statusCode, only10.statusCode].sort()).toEqual([201, 403]);
    });
```

Run: `pnpm --filter @mymozhem/server test -- xff-forwarded-for`
Expected: PASS; после прогона дописать в комментарий теста, какой из двух адресов оказался забанен (факт, не ожидание).

- [ ] **Step 4: Гейты + коммит**

Run: `pnpm --filter @mymozhem/server lint && pnpm --filter @mymozhem/server typecheck && pnpm --filter @mymozhem/server test`
Expected: зелёные (весь server-сьют, не только новый файл — лимитеры/лимиты не должны пересечься с существующими e2e).

```bash
git add apps/server/test/xff-forwarded-for.e2e-spec.ts
git commit -m "test(server): e2e exclusion/rate-limit через X-Forwarded-For — per-IP семантика REQ-ID-006 запинана (класс находки №7)"
```

---

## Батч B (клиент-ядро): Tasks 3–5

