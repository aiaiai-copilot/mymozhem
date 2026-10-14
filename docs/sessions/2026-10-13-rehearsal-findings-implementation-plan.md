# План: пакет фиксов по находкам репетиции первого события

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** закрыть 6 находок репетиции первого живого события (№7 bare-run регламент, №2 COOKIE_SECURE, №4 single-flight refresh, №5 автоперезаход, №6 рефетч-в-момент-действия, №3 стейл-roomId) и перевести их классы в автоматику (XFF e2e, LAN playwright-smoke, пин single-flight).

**Architecture:** серверная часть — один конфиг-флаг (`COOKIE_SECURE`) + e2e-сьют на существующем `TRUST_PROXY`; клиентская — четыре фикса в apps/web без изменения wire-контрактов и SDK; регламент — блок в чеклисте первого события + LAN-вариант playwright-конфига с fail-closed валидацией baseURL.

**Tech Stack:** NestJS+Fastify (packages/core, apps/server), React+vitest (apps/web), playwright (apps/web/e2e), jest e2e (apps/server/test).

**Spec:** `docs/sessions/2026-10-13-rehearsal-findings-design.md` (§0 — решения владельца; план аргументируется из неё, исполнитель читает оба файла).

## Global Constraints

- **TDD:** тест первым в каждой задаче (REQ-DEV-001); команды прогона указаны в шагах.
- **Гейты зелёные в конце каждой задачи:** `pnpm --filter <pkg> lint|typecheck|test` для затронутых пакетов; boundary-check (`pnpm verify-guardrails` из корня) не должен деградировать.
- **Wire-контракты и SDK не меняются** — все фиксы внутри границ модулей; boundary `web-only-through-sdk-and-app-packages` не трогаем.
- **Новых зависимостей нет** — все задачи на существующем стеке; один lockfile (REQ-DEV-002).
- **jest testPathPattern матчит ПУТЬ** (урок Quiz-среза): точечный прогон — по уникальному имени файла (`-- xff-forwarded-for`, не общие слова).
- **Комментарии на русском, в стиле репо:** причина/инвариант, не пересказ кода.
- **Витест include — `src/**/*.spec.ts`** (vite.config.ts); e2e-спеки туда не добавлять (см. Task 8 про суффикс `.vitest.spec.ts`).
- **Сессионное правило владельца:** исполнение батчами ≤3 задачи, каждый батч — отдельная сессия; после батча C — финальная приёмка (раздел в конце плана).

## Review Focus

Пять классов входов/условий, которые спека подразумевает, но чьи тесты легко упустить:

1. **Rebind при том же roomId:** onSessionDead-перезаход возвращает roomId ТОЙ ЖЕ комнаты — React не перезапустит effect useRoomBinding при одинаковом значении deps. Ожидание: соединение пересоздаётся. Владелец — Task 5 (промежуточный `setRoomId(null)` + rejoin следующим тиком; шаг-тест на `rejoinAsGuest` + приёмка строкой 12.2).
2. **Single-flight не запирает retry после провала:** мемо сбрасывается и на reject, иначе первая неудача refresh навсегда закрывает восстановление. Тест — Task 3, шаг 1 (кейс 3).
3. **Многоадресный XFF (`1.2.3.4, 10.0.0.1`):** какой адрес попадает в `req.ip` при trustProxy=true — семантика fastify/proxy-addr, не наша; exclusion обязан работать консистентно с ней. Тест-характеризация — Task 2, шаг 4.
4. **`COOKIE_SECURE=false` в hosted-деплое** — ошибка оператора, не код; ожидание: дефолт `auto` сохраняет прежнее поведение, compose без переменной не меняет куку. Пин — Task 1, шаг 1 (кейс auto+production) + шаг 5 (compose дефолт `:-auto`).
5. **`onSessionDead` не стреляет на обычный disconnect** (сетевой обрыв — self-heal socket.io, перезаход был бы потерей очков). Тест — Task 4, шаг 1 (кейс 2).

---

## Батч A (сервер): Tasks 1–2

### Task 1: Флаг `COOKIE_SECURE` (находка №2)

**Закрывает:** REQ-ID-008-контур (httpOnly нетронут), REQ-SEC-008-контур (дефолт нетронут); дизайн §2.

**Files:**
- Test: `packages/core/src/transport/refresh-cookie.spec.ts` (создать)
- Modify: `packages/core/src/config/config.schema.ts` (после блока TRUST_PROXY, ~стр. 51)
- Modify: `packages/core/src/transport/refresh-cookie.ts:20`
- Modify: `packages/core/src/testing/test-config.ts` (блок AppConfig)
- Modify: `packages/core/src/config/config.schema.spec.ts` (кейсы парсинга)
- Modify: `docker-compose.yml` (environment сервиса server)

**Interfaces:**
- Consumes: `AppConfig` (config.schema.ts), `ReplyLike` (http.types.ts), `TEST_CONFIG`.
- Produces: `AppConfig.COOKIE_SECURE: 'auto' | 'true' | 'false'` — потребителей в плане нет (читает только setRefreshCookie).

- [ ] **Step 1: Падающий unit-тест атрибута secure**

Создать `packages/core/src/transport/refresh-cookie.spec.ts`:

```ts
import { TEST_CONFIG } from '../testing/test-config';
import type { AppConfig } from '../config/config.schema';
import type { ReplyLike } from './http.types';
import { setRefreshCookie } from './refresh-cookie';

// Фейк ReplyLike: интересует только options.secure переданный в setCookie.
class FakeReply implements ReplyLike {
  cookieOptions: { secure: boolean } | null = null;
  setCookie(_name: string, _value: string, options: { secure: boolean }): unknown {
    this.cookieOptions = options;
    return this;
  }
  clearCookie(): unknown {
    return this;
  }
  redirect(): unknown {
    return this;
  }
}

const cfg = (over: Partial<AppConfig>): AppConfig => ({ ...TEST_CONFIG, ...over });

// Находка №2: LAN-стенд под NODE_ENV=production по plain HTTP — Secure-кука
// браузером не принимается. Флаг COOKIE_SECURE отделяет « Secure-атрибут» от
// NODE_ENV; дефолт auto = прежнее поведение (дизайн §2).
describe('setRefreshCookie + COOKIE_SECURE', () => {
  it.each([
    ['auto + production → secure', cfg({ COOKIE_SECURE: 'auto', NODE_ENV: 'production' }), true],
    ['auto + development → не secure', cfg({ COOKIE_SECURE: 'auto', NODE_ENV: 'development' }), false],
    ["'true' принудительно secure даже в development", cfg({ COOKIE_SECURE: 'true', NODE_ENV: 'development' }), true],
    ["'false' снимает secure даже в production (plain-HTTP LAN)", cfg({ COOKIE_SECURE: 'false', NODE_ENV: 'production' }), false],
  ] as const)('%s', (_label, config, expectedSecure) => {
    const reply = new FakeReply();
    setRefreshCookie(reply, 'refresh-token', config, 'REGISTERED');
    expect(reply.cookieOptions?.secure).toBe(expectedSecure);
  });
});
```

- [ ] **Step 2: Прогнать — должно падать**

Run: `pnpm --filter @mymozhem/core test -- refresh-cookie`
Expected: FAIL (TS: `COOKIE_SECURE` не существует в типе `AppConfig`).

- [ ] **Step 3: Падающий тест конфиг-парсинга**

В `packages/core/src/config/config.schema.spec.ts` добавить (стиль существующих кейсов файла):

```ts
it('COOKIE_SECURE: дефолт auto; принимает true/false; прочее — отказ', () => {
  const base = {
    DATABASE_URL: 'postgresql://localhost:5432/x',
    JWT_SECRET: 'x'.repeat(32),
    ORGANIZER_SETUP_TOKEN: 'y'.repeat(32),
  };
  expect(configSchema.parse(base).COOKIE_SECURE).toBe('auto');
  expect(configSchema.parse({ ...base, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe('false');
  expect(() => configSchema.parse({ ...base, COOKIE_SECURE: 'maybe' })).toThrow();
});
```

Run: `pnpm --filter @mymozhem/core test -- config.schema`
Expected: FAIL (`COOKIE_SECURE` unknown → дефолт не сработает; strict-схема либо выкинет ключ, либо упадёт — в любом случае первый ассерт красный).

- [ ] **Step 4: Реализация**

`config.schema.ts`, сразу после блока TRUST_PROXY:

```ts
  // ADR-012 self-hosted (находка №2): Secure-атрибут refresh-куки отделён от
  // NODE_ENV. auto — прежнее поведение (production = Secure); false — только
  // plain-HTTP LAN/self-hosted стенд. Hosted-деплой флаг не выставляет.
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
```

`refresh-cookie.ts` — заменить вычисление secure (и комментарий над функцией дополнить строкой про флаг):

```ts
  // COOKIE_SECURE (находка №2): auto — по NODE_ENV (прежняя норма), явное
  // значение побеждает (false — только plain-HTTP LAN, см. чеклист события).
  const secure =
    config.COOKIE_SECURE === 'auto'
      ? config.NODE_ENV === 'production'
      : config.COOKIE_SECURE === 'true';
```

и в `setCookie`-опциях использовать `secure` вместо `config.NODE_ENV === 'production'`.

`test-config.ts` — в TEST_CONFIG после `TRUST_PROXY: false,`:

```ts
  COOKIE_SECURE: 'auto',
```

- [ ] **Step 5: Прогнать — зелёное**

Run: `pnpm --filter @mymozhem/core test -- refresh-cookie`
Run: `pnpm --filter @mymozhem/core test -- config.schema`
Expected: PASS обе.

- [ ] **Step 6: Compose**

`docker-compose.yml`, environment сервера (рядом с TRUST_PROXY):

```yaml
      # ADR-012 self-hosted (находка №2): auto = Secure при NODE_ENV=production.
      # false — ТОЛЬКИ plain-HTTP LAN-стенд первого события (см. чеклист §0.4).
      COOKIE_SECURE: ${COOKIE_SECURE:-auto}
```

Проверка дефолта (Review Focus 4): `docker compose config` БЕЗ COOKIE_SECURE в окружении → в выводе `COOKIE_SECURE: auto`.

- [ ] **Step 7: Гейты + коммит**

Run: `pnpm --filter @mymozhem/core lint && pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core test`
Expected: зелёные (включая существующие cookie-потребители — auth.controller/join.controller спеки не тронуты, дефолт auto сохраняет поведение).

```bash
git add packages/core/src/transport/refresh-cookie.ts packages/core/src/transport/refresh-cookie.spec.ts packages/core/src/config/config.schema.ts packages/core/src/config/config.schema.spec.ts packages/core/src/testing/test-config.ts docker-compose.yml
git commit -m "feat(core): COOKIE_SECURE — Secure-атрибут refresh-куки отделён от NODE_ENV (находка №2, plain-HTTP LAN self-hosted)"
```

---

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

### Task 3: Single-flight refresh + `clearHostRoom` (находка №4, пин A3)

**Закрывает:** REQ-ID-016-контур (сессии; strict-ротация не смягчается); дизайн §4 + §8.3.

**Files:**
- Test: `apps/web/src/state/session.spec.ts` (добавить кейсы)
- Modify: `apps/web/src/state/session.ts` (`refresh()`, + `clearHostRoom()`)

**Interfaces:**
- Consumes: существующий `SessionStore` (конструктор с `refreshFn: () => Promise<string>`).
- Produces: `SessionStore.refresh()` — single-flight (конкурентные вызовы делят один запрос); `SessionStore.clearHostRoom(): void` — потребитель Task 6.

- [ ] **Step 1: Падающие тесты single-flight**

В `session.spec.ts`, в `describe('SessionStore')`:

```ts
  it('single-flight: конкурентные refresh() делят один вызов refreshFn (находка №4)', async () => {
    // HostGate + 401-retry ApiClient + refresh-хук RoomConnection могут дёрнуть
    // refresh одновременно с ОДНОЙ refresh-кукой; strict-ротация видит повторное
    // предъявление и гасит семью («rotation race lost» на репетиции 2026-10-13).
    let calls = 0;
    let resolveFn!: (token: string) => void;
    const store = new SessionStore(
      () =>
        new Promise<string>((resolve) => {
          calls += 1;
          resolveFn = resolve;
        }),
    );

    const p1 = store.refresh();
    const p2 = store.refresh();
    const p3 = store.refresh();
    resolveFn('tok-1');
    await Promise.all([p1, p2, p3]);

    expect(calls).toBe(1);
    expect(store.getAccessToken()).toBe('tok-1');
  });

  it('после settle следующий refresh вызывает refreshFn снова', async () => {
    let calls = 0;
    const store = new SessionStore(() => {
      calls += 1;
      return Promise.resolve(`tok-${calls}`);
    });

    await store.refresh();
    await store.refresh();

    expect(calls).toBe(2);
    expect(store.getAccessToken()).toBe('tok-2');
  });

  it('провал refresh не затирает токен и не блокирует следующую попытку (Review Focus 2)', async () => {
    let calls = 0;
    const store = new SessionStore(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('network')) : Promise.resolve('tok-recovered');
    });
    store.setAccessToken('tok-old');

    await expect(store.refresh()).rejects.toThrow('network');
    expect(store.getAccessToken()).toBe('tok-old'); // провал ≠ потеря токена

    await store.refresh(); // retry разрешён: мемо сброшен и на reject
    expect(store.getAccessToken()).toBe('tok-recovered');
    expect(calls).toBe(2);
  });

  it('clearHostRoom: сносит оба host-ключа (потребитель — консоль, находка №3)', () => {
    SessionStore.saveHostRoomId('room-1');
    SessionStore.saveHostRoomCode('ABCD-2345');

    SessionStore.clearHostRoom();

    expect(SessionStore.loadHostRoomId()).toBeNull();
    expect(SessionStore.loadHostRoomCode()).toBeNull();
  });
```

- [ ] **Step 2: Прогнать — должно падать**

Run: `pnpm --filter @mymozhem/web exec vitest run src/state/session.spec.ts`
Expected: FAIL (кейсы 1 и 3 — `calls === 3` вместо 1 / мемо отсутствует; кейс 4 — `clearHostRoom` не функция).

- [ ] **Step 3: Реализация**

В `session.ts` — поле и новый `refresh()`:

```ts
  // Single-flight (находка №4): конкурентные refresh (HostGate, 401-retry
  // ApiClient, refresh-хук RoomConnection) шлют ОДНУ refresh-куку; strict-ротация
  // читает повторное предъявление как кражу и гасит семью. In-flight промис
  // мемоизируется: конкуренты делят один запрос. Мемо сбрасывается на ЛЮБОМ
  // settle — retry после провала разрешён, следующий refresh работает.
  private inFlightRefresh: Promise<void> | null = null;

  async refresh(): Promise<void> {
    this.inFlightRefresh ??= this.refreshFn()
      .then((token) => {
        this.accessToken = token;
      })
      .finally(() => {
        this.inFlightRefresh = null;
      });
    return this.inFlightRefresh;
  }
```

и статический метод рядом с `saveHostRoomCode`:

```ts
  // Стейл-roomId консоли (находка №3): комната из прошлой БД — оба ключа
  // снимаются атомарно, чтобы гейт не увидел половину состояния.
  static clearHostRoom(): void {
    localStorage.removeItem(HOST_ROOM_KEY);
    localStorage.removeItem(HOST_ROOM_CODE_KEY);
  }
```

- [ ] **Step 4: Прогнать — зелёное**

Run: `pnpm --filter @mymozhem/web exec vitest run src/state/session.spec.ts`
Expected: PASS (все кейсы, включая 4 существующих).

- [ ] **Step 5: Гейты + коммит**

Run: `pnpm --filter @mymozhem/web lint && pnpm --filter @mymozhem/web typecheck && pnpm --filter @mymozhem/web test`

```bash
git add apps/web/src/state/session.ts apps/web/src/state/session.spec.ts
git commit -m "fix(web): single-flight refresh в SessionStore — конкурентные refresh делят один запрос (находка №4, rotation race)"
```

---

### Task 4: `onSessionDead` в RoomConnection + `joinError` в useRoomBinding (подложка №5 и №3)

**Закрывает:** дизайн §5 (триггер автоперезахода) и §7 (проброс кода отказа join); REQ-ID-016-контур.

**Files:**
- Test: `apps/web/src/realtime/room-connection.spec.ts` (добавить кейсы)
- Modify: `apps/web/src/realtime/room-connection.ts` (4-й параметр конструктора, вызов в catch)
- Modify: `apps/web/src/state/use-room-binding.ts` (opts + `joinError` + экспорт `joinErrorCode`)
- Test: `apps/web/src/state/use-room-binding.spec.ts` (создать — чистый `joinErrorCode`)

**Interfaces:**
- Consumes: `RoomConnection(socket, roomId, refreshAccessToken?)`, `useRoomBinding(roomId, tokens)`.
- Produces:
  - `new RoomConnection(socket, roomId, refreshAccessToken?, onSessionDead?: () => void)` — onSessionDead стреляет ТОЛЬКО из провала refresh-хука. Потребитель — Task 5.
  - `useRoomBinding(roomId, tokens, opts?: { onSessionDead?: () => void })` возвращает `+ joinError: string | null` (wire-код ApiError стартового join; null при успехе и при не-ApiError). Потребитель — Task 6.
  - `joinErrorCode(e: unknown): string | null` (экспорт из use-room-binding.ts).

- [ ] **Step 1: Падающие тесты RoomConnection**

В `room-connection.spec.ts` добавить (FakeSocket и flushMicrotasks уже есть в файле):

```ts
  it('провал refresh-хука → onSessionDead + состояние disconnected (находка №5)', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    let sessionDead = 0;
    const states: ConnectionState[] = [];
    const conn = new RoomConnection(
      socket,
      ROOM_ID,
      () => Promise.reject(new Error('refresh cookie dead')),
      () => {
        sessionDead += 1;
      },
    );
    conn.onStateChange((s) => states.push(s));

    socket.triggerConnect();
    await conn.join();
    socket.triggerDisconnect();
    socket.triggerConnectError();

    await flushMicrotasks();

    expect(sessionDead).toBe(1);
    expect(states[states.length - 1]).toBe('disconnected');
  });

  it('обычный disconnect (сеть) → onSessionDead НЕ стреляет (Review Focus 5)', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    let sessionDead = 0;
    const conn = new RoomConnection(socket, ROOM_ID, undefined, () => {
      sessionDead += 1;
    });

    socket.triggerConnect();
    await conn.join();
    socket.triggerDisconnect();
    await flushMicrotasks();

    expect(sessionDead).toBe(0);
  });
```

(Форма ok-ack — `{ ok: true, snapshot }`, как в существующих кейсах файла, стр. 82.)

- [ ] **Step 2: Прогнать — должно падать**

Run: `pnpm --filter @mymozhem/web exec vitest run src/realtime/room-connection.spec.ts`
Expected: FAIL (4-й параметр игнорируется → sessionDead === 0).

- [ ] **Step 3: Реализация RoomConnection**

`room-connection.ts`: конструктор += `private readonly onSessionDead?: () => void` (4-м, опциональным — существующие 3-аргументные вызовы не тронуты). В onConnectError заменить catch:

```ts
      if (!this.joined || this.refreshAttempted || !this.refreshAccessToken) return;
      this.refreshAttempted = true;
      // Провал refresh = мёртвая refresh-кука: self-heal невозможен, это единственная
      // ветка «сессия мертва» (находка №5). Состояние — disconnected (баннер честен
      // на время перезахода), onSessionDead — триггер автоперезахода страницы.
      // Обычный onDisconnect сюда НЕ ведёт: сетевой обрыв лечит сам socket.io.
      void this.refreshAccessToken()
        .catch(() => {
          this.stateCb?.('disconnected');
          this.onSessionDead?.();
        });
```

- [ ] **Step 4: Падающий тест `joinErrorCode`**

Создать `apps/web/src/state/use-room-binding.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/api-error';
import { joinErrorCode } from './use-room-binding';

// Код отказа стартового join (находка №3): консоль различает «комната из прошлой
// БД» (ACTOR_NOT_MEMBER → экран «не найдена») и сетевой обрыв (баннер). Хук
// без DOM-тестов (нет @testing-library/react — известный deferred T10), поэтому
// маппинг — чистая функция.
describe('joinErrorCode', () => {
  it('ApiError → wire-код', () => {
    expect(joinErrorCode(new ApiError('ACTOR_NOT_MEMBER', 0))).toBe('ACTOR_NOT_MEMBER');
    expect(joinErrorCode(new ApiError('NOT_FOUND', 404))).toBe('NOT_FOUND');
  });

  it('не-ApiError (сеть, ZodError) → null', () => {
    expect(joinErrorCode(new TypeError('fetch failed'))).toBeNull();
    expect(joinErrorCode(new Error('boom'))).toBeNull();
    expect(joinErrorCode('строка')).toBeNull();
  });
});
```

Run: `pnpm --filter @mymozhem/web exec vitest run src/state/use-room-binding.spec.ts`
Expected: FAIL (`joinErrorCode` не экспортирован).

- [ ] **Step 5: Реализация useRoomBinding**

`use-room-binding.ts`:

```ts
// Код отказа стартового join (находка №3): ApiError несёт wire-код; сетевые
// отказы (не ApiError) — null, их место — баннер 'disconnected', не экраны ошибок.
export const joinErrorCode = (e: unknown): string | null =>
  e instanceof ApiError ? e.code : null;
```

Сигнатура хука:

```ts
export function useRoomBinding(
  roomId: string | null,
  tokens: TokenProvider,
  opts?: { onSessionDead?: () => void },
): {
  connectionState: ConnectionState;
  events: ProjectedEvent[];
  appSettings: Record<string, unknown>;
  joinError: string | null;
  publish: (type: string, payload: Record<string, unknown>) => Promise<void>;
} {
```

В теле: `const [joinError, setJoinError] = useState<string | null>(null);`; в начало effect — `setJoinError(null);`; конструктору RoomConnection передать 4-м `opts?.onSessionDead`; в `join().catch`:

```ts
      .catch((e: unknown) => {
        setJoinError(joinErrorCode(e));
        setConnectionState('disconnected');
      });
```

В return добавить `joinError`. Депсы effect: `[roomId, tokens]` — `opts` НЕ добавлять (объект-литерал в deps перезапускал бы effect на каждый рендер; колбэк читается из замыкания effect — потребители передают стабильные useCallback). Комментарий об этом — у параметра opts.

- [ ] **Step 6: Прогнать — зелёное**

Run: `pnpm --filter @mymozhem/web exec vitest run src/realtime/room-connection.spec.ts src/state/use-room-binding.spec.ts`
Expected: PASS.

- [ ] **Step 7: Гейты + коммит**

Run: `pnpm --filter @mymozhem/web lint && pnpm --filter @mymozhem/web typecheck && pnpm --filter @mymozhem/web test`
Expected: зелёные; typecheck подтверждает, что существующие потребители useRoomBinding (play/screen/console) компилируются с новым полем в возврате (поле добавочное — ломать не должно).

```bash
git add apps/web/src/realtime/room-connection.ts apps/web/src/realtime/room-connection.spec.ts apps/web/src/state/use-room-binding.ts apps/web/src/state/use-room-binding.spec.ts
git commit -m "feat(web): onSessionDead в RoomConnection + joinError в useRoomBinding — подложка автоперезахода (№5) и диагностики стейл-roomId (№3)"
```

---

### Task 5: Автоперезаход play-page и screen-page (находка №5)

**Закрывает:** REQ-ID-016-контур, UX поверх REQ-ID-003; дизайн §5.

**Files:**
- Create: `apps/web/src/state/guest-rejoin.ts`
- Test: `apps/web/src/state/guest-rejoin.spec.ts`
- Modify: `apps/web/src/pages/play/play-page.tsx` (rejoin выделен + onSessionDead)
- Modify: `apps/web/src/pages/screen/screen-page.tsx` (join выделен + onSessionDead)

**Interfaces:**
- Consumes: `useRoomBinding(roomId, tokens, { onSessionDead })` (Task 4), `joinRoom` (endpoints), `decodeAccessClaims`/`SessionStore` (session.ts).
- Produces: `rejoinAsGuest(client: ApiClient, saved: GuestSession): Promise<{ accessToken: string; roomId: string }>` — потребителей в плане нет, кроме play-page.

- [ ] **Step 1: Падающий тест rejoinAsGuest**

Создать `apps/web/src/state/guest-rejoin.spec.ts` (fetch-стаб — по образцу api-client.spec.ts; makeToken — по образцу session.spec.ts):

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api-client';
import { rejoinAsGuest } from './guest-rejoin';

const makeToken = (claims: unknown): string =>
  `hdr.${btoa(JSON.stringify(claims))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}.sig`;

const anon = new ApiClient({ getAccessToken: () => null, refresh: () => Promise.resolve() });

// Автоперезаход (находка №5): мёртвая refresh-кука → новый join по сохранённым
// code/displayName. roomId берём из claims нового токена, а не из ответа формы —
// одна точка правды с авто-входом §5.
describe('rejoinAsGuest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('join по сохранённым code/displayName → accessToken + roomId из claims', async () => {
    const token = makeToken({ sub: 'id-1', kind: 'GUEST', roomId: 'room-9' });
    const fetchMock = vi.fn(async () =>
      new Response(
        // joinResponseSchema (SDK 2.0.0, strict): tokenResponse + displayName;
        // refreshToken в теле НЕТ — refresh живёт в httpOnly-куке.
        JSON.stringify({ accessToken: token, tokenType: 'Bearer', expiresIn: 900, displayName: 'Гость 7' }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await rejoinAsGuest(anon, { code: 'ABCD-2345', displayName: 'Гость 7' });

    expect(res).toEqual({ accessToken: token, roomId: 'room-9' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ code: 'ABCD-2345', displayName: 'Гость 7' });
  });

  it('токен без roomId → throw (fail-loud, не тихий null)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            accessToken: makeToken({ sub: 'id-1', kind: 'GUEST' }),
            tokenType: 'Bearer',
            expiresIn: 900,
            displayName: 'x',
          }),
          { status: 201 },
        ),
      ),
    );

    await expect(rejoinAsGuest(anon, { code: 'C', displayName: 'x' })).rejects.toThrow('roomId');
  });
});
```

(Формы верифицированы при планировании: `joinResponseSchema` = strictObject tokenResponse {accessToken, tokenType:'Bearer', expiresIn} + displayName; fetch-стаб через глобальный Response — как в api-client.spec.ts.)

- [ ] **Step 2: Прогнать — должно падать**

Run: `pnpm --filter @mymozhem/web exec vitest run src/state/guest-rejoin.spec.ts`
Expected: FAIL (модуль не существует).

- [ ] **Step 3: Реализация guest-rejoin.ts**

```ts
import type { ApiClient } from '../api/api-client';
import { joinRoom } from '../api/endpoints';
import { decodeAccessClaims, type GuestSession } from './session';

// Автоперезаход при мёртвой сессии (находка №5): refresh-кука мертва → новый
// join по сохранённым code/displayName = НОВАЯ identity, очки не переносятся
// (тот же контракт, что авто-вход дизайна §5, — там тот же путь на загрузке
// страницы). Вызывающий показывает баннер «вы вошли заново».
export async function rejoinAsGuest(
  client: ApiClient,
  saved: GuestSession,
): Promise<{ accessToken: string; roomId: string }> {
  const res = await joinRoom(client, { code: saved.code, displayName: saved.displayName });
  const claims = decodeAccessClaims(res.accessToken);
  if (!claims.roomId) throw new Error('join token without roomId');
  return { accessToken: res.accessToken, roomId: claims.roomId };
}
```

Run: `pnpm --filter @mymozhem/web exec vitest run src/state/guest-rejoin.spec.ts` → PASS.

- [ ] **Step 4: play-page — rejoin выделен, onSessionDead подключён**

В `play-page.tsx`:

1. Импорт `rejoinAsGuest` из '../../state/guest-rejoin'.
2. Добавить refs/колбэк (рядом с autoJoinStarted):

```ts
  const rejoinInFlight = useRef(false);

  // Перезаход с новой identity (находка №5): общий путь для авто-входа §5
  // (TTL протух на загрузке) и onSessionDead (кука умерла на живой странице).
  // Гард: один перезаход в полёте — повторный onSessionDead не плодит identity.
  const rejoin = useCallback(async () => {
    const s = SessionStore.loadGuest();
    if (!s || rejoinInFlight.current) return;
    rejoinInFlight.current = true;
    try {
      const res = await rejoinAsGuest(anonClient, s);
      session.setAccessToken(res.accessToken);
      setRejoined(true);
      setRoomId(res.roomId);
    } catch {
      // Сохранённое больше не валидно (комната удалена/закрыта) — забываем
      // его и честно показываем форму, а не вечный «Входим…».
      SessionStore.clearGuest();
      setSaved(null);
      setAutoJoinError('Сохранённая сессия недействительна. Войдите заново.');
    } finally {
      rejoinInFlight.current = false;
    }
  }, [session]);
```

3. Mount-effect: catch-ветку (блок joinRoom inline, ~стр. 86-92) заменить на `await rejoin();` — текст ошибки и поведение сохраняются (теперь внутри rejoin). Добавить `rejoin` в deps effect.
4. Binding:

```ts
  const binding = useRoomBinding(roomId, session, {
    onSessionDead: useCallback(() => {
      // Rebind при том же roomId (Review Focus 1): React не перезапустит effect
      // при одинаковом значении deps — сначала отвязываемся (cleanup закроет
      // мёртвое соединение), rejoin следующим тиком установит roomId заново.
      setRoomId(null);
      setTimeout(() => void rejoin(), 0);
    }, [rejoin]),
  });
```

Хуки — до любых условных return (в файле их нет до binding, порядок сохранить).

- [ ] **Step 5: screen-page — то же для spectator**

В `screen-page.tsx` (текущий one-shot join ~стр. 61-86):

1. `joinStarted` ref заменить на `joinInFlight` (сбрасывается в finally) — перезаходу нужен повторный вход; StrictMode-перекрытие по-прежнему отсекает параллельный дубль.
2. Тело effect выделить в `joinSpectator = useCallback(...)` (deps `[code, session]`), в начале `setJoinError(null);`.
3. Effect: `useEffect(() => { void joinSpectator(); }, [joinSpectator]);`
4. Binding:

```ts
  const binding = useRoomBinding(roomId, session, {
    onSessionDead: useCallback(() => {
      // См. play-page: отвязка → перезаход следующим тиком (rebind при том же roomId).
      setRoomId(null);
      setTimeout(() => void joinSpectator(), 0);
    }, [joinSpectator]),
  });
```

Комментарий у onSessionDead: spectator перезаход = новый spectator 'Экран', saveGuest не трогаем (существующий контракт страницы: зритель не затирает guest-сессию).

- [ ] **Step 6: Гейты + коммит**

Run: `pnpm --filter @mymozhem/web lint && pnpm --filter @mymozhem/web typecheck && pnpm --filter @mymozhem/web test`
Expected: зелёные. Ручная верификация wiring перенесена в приёмку (строка 12.2 чеклиста) — страницы без DOM-тестов (нет @testing-library/react, известный deferred).

```bash
git add apps/web/src/state/guest-rejoin.ts apps/web/src/state/guest-rejoin.spec.ts apps/web/src/pages/play/play-page.tsx apps/web/src/pages/screen/screen-page.tsx
git commit -m "fix(web): автоперезаход при мёртвой сессии — onSessionDead → rejoin без перезагрузки (находка №5)"
```

---

## Батч C (консоль + автоматика): Tasks 6–8

### Task 6: Стейл-roomId в консоли (находка №3)

**Закрывает:** UX-фикс без REQ; дизайн §7.

**Files:**
- Modify: `apps/web/src/pages/host/console-page.tsx`
- Test: `apps/web/src/pages/host/console-page.spec.ts` (создать — чистый предикат)

**Interfaces:**
- Consumes: `binding.joinError` (Task 4), `SessionStore.clearHostRoom()` (Task 3).
- Produces: `isStaleRoomJoinError(code: string | null): boolean` (экспорт из console-page.tsx).

- [ ] **Step 1: Падающий тест предиката**

Создать `console-page.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isStaleRoomJoinError } from './console-page';

// Стейл-roomId (находка №3): комната из прошлой БД → join отказывает
// ACTOR_NOT_MEMBER; консоль обязана показать «комната не найдена», а не
// вечный «Нет соединения». NOT_FOUND — на случай будущего REST-восстановления
// комнаты; сетевые отказы (null) сюда не попадают.
describe('isStaleRoomJoinError', () => {
  it('ACTOR_NOT_MEMBER и NOT_FOUND → true', () => {
    expect(isStaleRoomJoinError('ACTOR_NOT_MEMBER')).toBe(true);
    expect(isStaleRoomJoinError('NOT_FOUND')).toBe(true);
  });

  it('прочие коды и null (сеть) → false', () => {
    expect(isStaleRoomJoinError('ROOM_NOT_ACTIVE')).toBe(false);
    expect(isStaleRoomJoinError('SESSION_INVALID')).toBe(false);
    expect(isStaleRoomJoinError(null)).toBe(false);
  });
});
```

Run: `pnpm --filter @mymozhem/web exec vitest run src/pages/host/console-page.spec.ts`
Expected: FAIL (экспорта нет).

- [ ] **Step 2: Реализация**

`console-page.tsx`:

1. Экспорт предиката (до компонента):

```ts
// Стейл-roomId (находка №3): сохранённая комната из прошлой БД — join отказывает
// ACTOR_NOT_MEMBER; это «комнаты нет», а не «нет соединения».
export const isStaleRoomJoinError = (code: string | null): boolean =>
  code === 'ACTOR_NOT_MEMBER' || code === 'NOT_FOUND';
```

2. Состояние и effect (хуки — рядом с существующими, до рендер-веток):

```ts
  const [roomGone, setRoomGone] = useState(false);

  // Однократно на переход joinError: ключи снимаем атомарно (clearHostRoom),
  // иначе следующий заход на /host снова приведёт в мёртвую комнату.
  useEffect(() => {
    if (isStaleRoomJoinError(binding.joinError)) {
      SessionStore.clearHostRoom();
      setRoomGone(true);
    }
  }, [binding.joinError]);
```

3. Рендер-ветка СРАЗУ ПОСЛЕ существующей `if (!roomId)`:

```tsx
  if (roomGone) {
    return (
      <main>
        <h1>Комната не найдена</h1>
        <p>Сохранённая комната больше не существует (стенд был пересоздан). Создайте новую.</p>
        <p>
          <a href="/host/setup">К настройке комнаты</a>
        </p>
      </main>
    );
  }
```

- [ ] **Step 3: Прогнать + гейты + коммит**

Run: `pnpm --filter @mymozhem/web exec vitest run src/pages/host/console-page.spec.ts` → PASS.
Run: `pnpm --filter @mymozhem/web lint && pnpm --filter @mymozhem/web typecheck && pnpm --filter @mymozhem/web test`

```bash
git add apps/web/src/pages/host/console-page.tsx apps/web/src/pages/host/console-page.spec.ts
git commit -m "fix(web): консоль диагностирует стейл-roomId — «комната не найдена» + очистка ключей (находка №3)"
```

---

### Task 7: Рефетч ростера в момент действия + по фокусу (находка №6)

**Закрывает:** UX-гарда поверх REQ-ID-006; дизайн §6. Решение владельца: без поллинга.

**Files:**
- Modify: `apps/web/src/pages/host/members-panel.tsx` (exclude с pre-refetch)
- Test: `apps/web/src/pages/host/members-panel.spec.ts` (создать)
- Create: `apps/web/src/state/focus-refetch.ts`
- Test: `apps/web/src/state/focus-refetch.spec.ts`
- Modify: `apps/web/src/state/use-room-feed.ts` (focus-effect)

**Interfaces:**
- Consumes: `listMembers`, `excludeMember` (endpoints), `hostClient` (host-session).
- Produces:
  - `excludeIfStillActive(deps, roomId, identityId): Promise<'excluded' | 'stale'>` (экспорт из members-panel.tsx);
  - `createFocusRefetcher(refetch, minIntervalMs?, now?): () => void` (экспорт из focus-refetch.ts), потребитель — use-room-feed.

- [ ] **Step 1: Падающий тест excludeIfStillActive**

Создать `members-panel.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { RosterEntry } from '@mymozhem/sdk';
import { excludeIfStillActive } from './members-panel';

// rosterEntrySchema (SDK, strict): { identityId: uuid, displayName: string|null,
// role: lowercase } — joinedAt на wire НЕТ, фикстура минимальна.
const entry = (identityId: string): RosterEntry => ({
  identityId,
  displayName: 'Игрок',
  role: 'participant',
});

// Рефетч в момент действия (находка №6): join не эмитит событий (I-3), ростер
// консоли стейл — «Исключить» по прежней identity перезашедшего бьёт мимо.
// Перед exclude ростер рефетчится; ушедшей identity exclude НЕ отправляется.
describe('excludeIfStillActive', () => {
  it('identity активна в свежем ростере → exclude отправлен (listMembers ДО exclude)', async () => {
    const calls: string[] = [];
    const deps = {
      listMembers: async (_roomId: string) => {
        calls.push('list');
        return { members: [entry('id-1')] };
      },
      excludeMember: async (_roomId: string, _identityId: string) => {
        calls.push('exclude');
      },
    };

    const result = await excludeIfStillActive(deps, 'room-1', 'id-1');

    expect(result).toBe('excluded');
    expect(calls).toEqual(['list', 'exclude']);
  });

  it('identity исчезла (перезаход) → exclude НЕ отправлен', async () => {
    const calls: string[] = [];
    const deps = {
      listMembers: async (_roomId: string) => {
        calls.push('list');
        return { members: [entry('id-new')] };
      },
      excludeMember: async (_roomId: string, _identityId: string) => {
        calls.push('exclude');
      },
    };

    const result = await excludeIfStillActive(deps, 'room-1', 'id-1');

    expect(result).toBe('stale');
    expect(calls).toEqual(['list']);
  });
});
```

(Форма `RosterEntry` верифицирована при планировании: `rosterEntrySchema` — strictObject {identityId, displayName nullable, role}; id в тестах — произвольные строки, схема-парсинг здесь не задействован.)

Run: `pnpm --filter @mymozhem/web exec vitest run src/pages/host/members-panel.spec.ts`
Expected: FAIL (экспорта нет).

- [ ] **Step 2: Реализация members-panel**

В `members-panel.tsx`:

```ts
// Оркестрация exclude с рефетчем-в-момент-действия (находка №6) — вынесена из
// компонента для теста без DOM (прецедент: чистые экспорты quiz-controls).
// 'stale' — identity уже не в активном ростере (перезаход): exclude не шлём,
// вызывающий обновляет ростер и просит выбрать заново.
export async function excludeIfStillActive(
  deps: {
    listMembers: (roomId: string) => Promise<{ members: RosterEntry[] }>;
    excludeMember: (roomId: string, identityId: string) => Promise<unknown>;
  },
  roomId: string,
  identityId: string,
): Promise<'excluded' | 'stale'> {
  const fresh = await deps.listMembers(roomId);
  if (!fresh.members.some((m) => m.identityId === identityId)) return 'stale';
  await deps.excludeMember(roomId, identityId);
  return 'excluded';
}
```

Тело `exclude` в компоненте:

```ts
  const exclude = (identityId: string) => {
    if (disabled || excludingId !== null) return; // одна команда за раз
    setExcludingId(identityId);
    setError(null);
    void excludeIfStillActive(
      {
        listMembers: (r) => listMembers(hostClient, r),
        excludeMember: (r, id) => excludeMember(hostClient, r, id),
      },
      roomId,
      identityId,
    )
      .then((result) => {
        // Стейл-ростер (№6): участник перезашёл между загрузкой и кликом —
        // показываем свежий список и просим выбрать заново, exclude не ушёл.
        if (result === 'stale') setError('Участник перезашёл — список обновлён, выберите заново.');
        onChanged();
      })
      .catch((e: unknown) => setError(excludeErrorText(e)))
      .finally(() => setExcludingId(null));
  };
```

Импорт `listMembers` добавить к `excludeMember`.

- [ ] **Step 3: Падающий тест createFocusRefetcher**

Создать `apps/web/src/state/focus-refetch.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createFocusRefetcher } from './focus-refetch';

// Дедуп рефетча по фокусу (находка №6): visibilitychange и focus приходят парой
// на одно возвращение во вкладку — ростер дёргаем не чаще minIntervalMs.
describe('createFocusRefetcher', () => {
  it('события в пределах окна → один рефетч; после окна → следующий', () => {
    const refetch = vi.fn();
    let now = 1_000;
    const onFocus = createFocusRefetcher(refetch, 2_000, () => now);

    onFocus(); // t=1000 → рефетч
    now = 2_000;
    onFocus(); // внутри окна → пропуск
    now = 3_500; // 3500-1000 = 2500 > 2000
    onFocus(); // рефетч

    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
```

Run: `pnpm --filter @mymozhem/web exec vitest run src/state/focus-refetch.spec.ts`
Expected: FAIL (модуль не существует).

- [ ] **Step 4: Реализация focus-refetch + wiring в use-room-feed**

`focus-refetch.ts`:

```ts
// Дедуп рефетча по фокусу окна (находка №6): visibilitychange→visible и focus
// приходят парой; не чаще одного вызова в minIntervalMs. Чистая фабрика —
// тест без DOM; visibility-фильтр остаётся в вызывающем (use-room-feed).
export function createFocusRefetcher(
  refetch: () => void,
  minIntervalMs = 2_000,
  now: () => number = Date.now,
): () => void {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < minIntervalMs) return;
    last = t;
    refetch();
  };
}
```

`use-room-feed.ts` — третий effect (после событийного рефетча), импорт `createFocusRefetcher`:

```ts
  // Рефетч по возврату во вкладку (находка №6): join не эмитит событий — ростер
  // стейл, пока ведущий был в другой вкладке. Без поллинга (решение владельца);
  // дедуп парных visibilitychange/focus — в createFocusRefetcher.
  useEffect(() => {
    if (!roomId) return;
    const onFocus = createFocusRefetcher(() => {
      if (document.visibilityState === 'visible') refetchMembers();
    });
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [roomId, refetchMembers]);
```

- [ ] **Step 5: Прогнать + гейты + коммит**

Run: `pnpm --filter @mymozhem/web exec vitest run src/pages/host/members-panel.spec.ts src/state/focus-refetch.spec.ts` → PASS.
Run: `pnpm --filter @mymozhem/web lint && pnpm --filter @mymozhem/web typecheck && pnpm --filter @mymozhem/web test`

```bash
git add apps/web/src/pages/host/members-panel.tsx apps/web/src/pages/host/members-panel.spec.ts apps/web/src/state/focus-refetch.ts apps/web/src/state/focus-refetch.spec.ts apps/web/src/state/use-room-feed.ts
git commit -m "fix(web): exclude с рефетчем ростера в момент действия + рефетч по фокусу окна (находка №6)"
```

---

### Task 8: LAN playwright-smoke (A2) + чеклист первого события (№7 регламент)

**Закрывает:** REQ-DEV-001-контур (процедурный); дизайн §3 + §8.2.

**Files:**
- Create: `apps/web/e2e/lan-base-url.ts`
- Test: `apps/web/e2e/lan-base-url.vitest.spec.ts`
- Create: `apps/web/e2e/playwright.config.lan.ts`
- Modify: `apps/web/e2e/playwright.config.ts` (`testMatch`)
- Modify: `apps/web/vite.config.ts` (vitest include)
- Modify: `apps/web/package.json` (script test:e2e:lan)
- Modify: `docs/sessions/2026-09-23-ui-slice-smoke-checklist.md` (блок §0.4 + строки протокола)

**Interfaces:**
- Consumes: существующий smoke.spec.ts (не меняется).
- Produces: `assertLanBaseUrl(raw: string | undefined): string`; команда `pnpm --filter @mymozhem/web test:e2e:lan` (требует env LAN_BASE_URL).

**Почему суффикс `.vitest.spec.ts`:** playwright по умолчанию подхватывает `*.spec.ts` из testDir, vitest include — `src/**`; пересечение устраняем двумя ходами: оба playwright-конфига получают явный `testMatch: 'smoke.spec.ts'` (заодно пин «сьют = один файл»), vitest include += `'e2e/**/*.vitest.spec.ts'`.

- [ ] **Step 1: Падающий тест валидации**

Создать `apps/web/e2e/lan-base-url.vitest.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertLanBaseUrl } from './lan-base-url';

// Fail-closed валидация LAN_BASE_URL (дизайн §8.2): только localhost/RFC1918 по
// plain http. Прогон e2e по внешнему адресу запрещён конфигурационно — интент
// «никогда не production» базового playwright.config.ts здесь машинный.
describe('assertLanBaseUrl', () => {
  it.each([
    ['http://192.168.0.186:3000', 'http://192.168.0.186:3000'],
    ['http://10.0.0.5:3000', 'http://10.0.0.5:3000'],
    ['http://172.16.1.1:3000', 'http://172.16.1.1:3000'],
    ['http://172.31.255.254:3000', 'http://172.31.255.254:3000'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000'], // origin без trailing slash
  ])('разрешён: %s', (input, expected) => {
    expect(assertLanBaseUrl(input)).toBe(expected);
  });

  it.each([
    ['https://192.168.0.186:3000', 'plain http'], // TLS на LAN-стенде нет
    ['http://8.8.8.8:3000', 'RFC1918'], // публичный IP
    ['http://172.15.0.1:3000', 'RFC1918'], // вне диапазона 172.16–31
    ['http://172.32.0.1:3000', 'RFC1918'],
    ['http://192.167.0.1:3000', 'RFC1918'],
    ['http://mymozhem.example.com', 'RFC1918'], // домен, не IP
    ['not-a-url', 'URL'],
  ])('отказ: %s', (input, marker) => {
    expect(() => assertLanBaseUrl(input)).toThrow(marker);
  });

  it('отсутствующая переменная — отказ с подсказкой формата', () => {
    expect(() => assertLanBaseUrl(undefined)).toThrow('LAN_BASE_URL обязателен');
  });
});
```

Run: `pnpm --filter @mymozhem/web exec vitest run e2e/lan-base-url.vitest.spec.ts`
Expected: FAIL (модуль не существует И vitest include не покрывает e2e — сначала шаг 3).

- [ ] **Step 2: Реализация lan-base-url.ts**

Создать `apps/web/e2e/lan-base-url.ts`:

```ts
// Fail-closed валидация LAN_BASE_URL (дизайн §8.2): только localhost или
// RFC1918-адрес по plain http. Любой другой хост/схема (включая публичный прод)
// — отказ ДО старта тестов. Возвращает origin (без пути/trailing slash).
export function assertLanBaseUrl(raw: string | undefined): string {
  if (!raw) {
    throw new Error('LAN_BASE_URL обязателен (например http://192.168.0.186:3000)');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`LAN_BASE_URL не является URL: ${raw}`);
  }
  if (url.protocol !== 'http:') {
    throw new Error(`LAN_BASE_URL: разрешён только plain http LAN-стенда, получено ${url.protocol}//`);
  }
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return url.origin;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  const isPrivate =
    m !== null &&
    (Number(m[1]) === 10 ||
      (Number(m[1]) === 172 && Number(m[2]) >= 16 && Number(m[2]) <= 31) ||
      (Number(m[1]) === 192 && Number(m[2]) === 168));
  if (!isPrivate) {
    throw new Error(
      `LAN_BASE_URL: хост ${host} не localhost/RFC1918 — прогон e2e по внешнему адресу запрещён`,
    );
  }
  return url.origin;
}
```

- [ ] **Step 3: vitest include + playwright testMatch**

`vite.config.ts` — test.include:

```ts
    include: ['src/**/*.spec.ts', 'e2e/**/*.vitest.spec.ts'],
```

(комментарий: суффикс .vitest.spec.ts — e2e-спеки, которые playwright НЕ подхватывает: у обоих playwright-конфигов явный testMatch).

`e2e/playwright.config.ts` — добавить в defineConfig:

```ts
  testMatch: 'smoke.spec.ts',
```

Run: `pnpm --filter @mymozhem/web exec vitest run e2e/lan-base-url.vitest.spec.ts`
Expected: PASS.

- [ ] **Step 4: LAN-конфиг playwright + script**

Создать `apps/web/e2e/playwright.config.lan.ts`:

```ts
import { defineConfig } from '@playwright/test';
import { assertLanBaseUrl } from './lan-base-url';

// LAN-вариант smoke (дизайн 2026-10-13 §8.2, находки репетиции): прогон против
// стенда по IP машины — ловит класс «браузер × топология», невидимый с localhost
// (CSP, Secure-кука, NAT). Сьют/таймауты идентичны базовому конфигу; baseURL —
// из LAN_BASE_URL с fail-closed валидацией (только localhost/RFC1918 по http).
export default defineConfig({
  workers: 1,
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  testMatch: 'smoke.spec.ts',
  use: {
    baseURL: assertLanBaseUrl(process.env.LAN_BASE_URL),
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
```

`apps/web/package.json` scripts += :

```json
    "test:e2e:lan": "playwright test --config e2e/playwright.config.lan.ts",
```

Проверка fail-closed (не прогон тестов, а отказ конфига):
Run: `cd apps/web && LAN_BASE_URL=https://evil.example.com npx playwright test --config e2e/playwright.config.lan.ts --list`
Expected: конфиг падает с «не localhost/RFC1918».
Run: `LAN_BASE_URL=http://192.168.0.186:3000 npx playwright test --config e2e/playwright.config.lan.ts --list`
Expected: список из smoke.spec.ts (тесты НЕ запускаются — стенд в этой задаче не поднимаем).

- [ ] **Step 5: Чеклист первого события**

В `docs/sessions/2026-09-23-ui-slice-smoke-checklist.md`:

1. Новый блок после §0.3:

```markdown
### 0.4. Стенд на событие — bare-run сервера (находка №7)

docker NAT скрывает реальные IP клиентов (exclusion по IP банит всех, rate-limit
общий — воспроизведено на репетиции 2026-10-13). На событие сервер запускается
НА ХОСТЕ, в контейнере остаётся только БД:

1. `docker compose up postgres` (только БД).
2. `pnpm build` из корня.
3. Сервер на хосте: `DATABASE_URL=postgresql://mymozhem:mymozhem@localhost:5432/mymozhem JWT_SECRET=... ORGANIZER_SETUP_TOKEN=... PRIZE_MODE=off COOKIE_SECURE=false pnpm --filter @mymozhem/server start`.
   ВНИМАНИЕ: compose по умолчанию НЕ публикует порт 5432 на хост — для bare-run
   добавить в docker-compose.override.yml или пробросить порт одноразово
   (`docker compose run`-стиль не подходит; см. комментарий в docker-compose.yml).
4. Web отдаётся тем же сервером (WEB_STATIC_DIR) — один origin на LAN-IP хоста.
5. COOKIE_SECURE=false — ТОЛЬКИ для plain-HTTP LAN (находка №2): иначе телефоны
   не примут refresh-куку и сессия будет с 15-минутным потолком.
6. Контрольная строка: участник с телефона исключается → ROOM_JOIN_DENIED
   получает ТОЛЬКО он, остальные продолжают. Вторая контрольная: вход 5+
   устройств подряд без 429.
7. Перед гостями: LAN-smoke — `LAN_BASE_URL=http://<IP-хоста>:3000 pnpm --filter @mymozhem/web test:e2e:lan`.
```

2. В таблицу «Протокол прогона» добавить строки (статус «⬜ не прогнано»):

```markdown
| 0.4 | стенд на событие: bare-run + COOKIE_SECURE=false + LAN-smoke | ⬜ | Добавлено 2026-10-13 (сессия 38, пакет фиксов репетиции); прогон — при подготовке первого события |
```

- [ ] **Step 6: Гейты + коммит**

Run: `pnpm --filter @mymozhem/web lint && pnpm --filter @mymozhem/web typecheck && pnpm --filter @mymozhem/web test`
Expected: зелёные (typecheck не покрывает e2e/*.ts — известный deferred T16; lan-конфиг проверен шагом 4 эмпирически).

```bash
git add apps/web/e2e/lan-base-url.ts apps/web/e2e/lan-base-url.vitest.spec.ts apps/web/e2e/playwright.config.lan.ts apps/web/e2e/playwright.config.ts apps/web/vite.config.ts apps/web/package.json docs/sessions/2026-09-23-ui-slice-smoke-checklist.md
git commit -m "feat(web): LAN playwright-smoke с fail-closed валидацией baseURL + чеклист bare-run стенда (находка №7, дизайн §8.2)"
```

---

## Батч D (приёмочные находки 2026-10-14): Tasks 9–10

**Происхождение:** ручная приёмка пакета 2026-10-14 (сырой протокол — `2026-10-14-acceptance-raw-notes.md`): строки 0.4/7.1/11.1/12.2 пройдены, но прогон дал находки A (дефект, чинить до мерджа) и №8 (решение владельца 2026-10-14: чинить в этом же пакете). Дизайн батча — bounded (brainstorm в чате, одобрен владельцем 2026-10-14), без отдельного design-документа. REQ-разметка: новых REQ не закрывают — багфиксы приёмки UI-среза; смежное — REQ-RT-010 (не тронут), REQ-ID-013 (не тронут).

### Task 9: Ссылка стейл-roomId на существующий маршрут (находка A)

- **Дефект:** `console-page.tsx` экран «Комната не найдена» ссылался на `/host/setup` → 404; реальный маршрут — `/host/new`. Просочилось как немашинное место (I-3): план/ревью пиновали несуществующий путь.
- **Фикс:** `apps/web/src/routes.ts` — `HOST_NEW_PATH = '/host/new'` как единый источник wire-пути; роутер (`App.tsx`) и ссылка (`console-page.tsx`) импортируют константу — дрейф устранён структурно. Пин-спека `routes.spec.ts` на wire-значение. (Вариант «поправить строку» отклонён: класс повторился бы.)
- **Коммит:** `9b36613`. RED: module not found → GREEN.

### Task 10: Кик reconnect'а при пробуждении вкладки (находка №8)

- **Дефект:** WebKit (Safari desktop, Chrome-iOS) после сна вкладки > TTL: handshake отклонён (jwt expired), refresh успешен, но reconnect socket.io не возобновляется — вечный баннер до reload. Chrome-desktop не пострадал.
- **Корень (верифицирован по socket.io-client 4.8.3 manager.js/socket.js):** WebKit выбрасывает pending backoff-таймер замороженной вкладки; Manager застревает с `_reconnecting=true` без запланированной попытки — все внутренние retry-пути (`reconnect()`, `maybeReconnectOnOpen()`) заперты этим флагом, а `Socket.connect()` открывает Manager только при `!_reconnecting` (наивный кик `socket.connect()` — no-op ровно в застрявшем состоянии).
- **Фикс:** `SocketLike` += `isConnected()`/`kickReconnect()`; кик в `socket-like.ts`: `socket.io._close()` (сброс `_reconnecting`, очистка таймеров; публичен по d.ts, подчёркнут по конвенции — tripwire-комментарий при апгрейде) + `socket.connect()` (немедленная попытка в обход backoff, токен — auth-колбэком). `RoomConnection.wakeUp()` — кик только при `joined && !isConnected()` (идемпотентен; начальным подключением управляет сам socket.io). Wiring `useRoomBinding`: `visibilitychange`(visible)/`focus`/`pageshow` (bfcache — ключевой сигнал iOS) через существующий `createFocusRefetcher`-дедуп (2 с). Протухший токен — прежний путь connect_error → один refresh → retry. `online`-слушатель отклонён (YAGNI: на видимой вкладке возврат сети лечит ping-timeout socket.io).
- **Тесты:** 3 кейса wakeUp в room-connection.spec.ts (кик при мёртвом соединении ×2, no-op при живом, no-op до join). Wiring — немашинное место (I-3): приёмка — новая строка чеклиста **8.2** (ручная, Safari/iOS, до мерджа).
- **Коммит:** `c10bcb4`. RED: `conn.wakeUp is not a function` ×3 → GREEN (весь web-сьют 19/115).
- **Формализация этой же сессией:** таблица протокола чеклиста (0.4/7.1/11.1/12.2 ✅, строка 8.2 ⬜), оговорка §0.4 п.8 (не исключать localhost-участников на bare-run).

---

## Финальная приёмка пакета (после батча C, в той же сессии батча C или отдельной по правилу владельца)

1. **Двухстадийное ревью** (superpowers:requesting-code-review): стадия 1 — spec-compliance по REQ-разметке каждой задачи (заголовки «Закрывает:» + §10 дизайна); стадия 2 — code-quality. Батчи A–C — выполнено (сессия 41); батч D — отдельным ревью (сессия 2026-10-14).
2. **Ручной прогон строк чеклиста** против LAN-стенда (compose с `COOKIE_SECURE=false` или bare-run): 7.1 (reload консоли — сессия жива), 11.1 (exclude бьёт ровно одного; стейл-ростер → alert «перезашёл»), 12.2 (reload участника; протухание → автоперезаход без перезагрузки). Статусы — в таблицу протокола. **Прогнано 2026-10-14: все 4 строки ✅ (протокол — `2026-10-14-acceptance-raw-notes.md` + таблица чеклиста).** Осталась строка **8.2** (WebKit-регресс находки №8, батч D) — ручной прогон на Safari/iOS до мерджа.
3. **HANDOFF** обновить (находки закрыты, автоматика введена, открытые решения сняты).
4. Merge в `main` no-ff, push, удаление ветки — по установленному ритуалу репо.

## Self-review (интерпретации плана — для ревью владельцем)

- **I-1 (Task 2, шаг 2):** XFF-сьют зелёный сразу — это осознанно характеризационный страж: дефект №7 был топологией деплоя, а не серверной логикой. Красный кейс на шаге 2 = реальная находка → стоп и эскалация, а не «чинить под тест».
- **I-2 (Task 4, шаг 5):** `opts` сознательно НЕ в deps effect useRoomBinding — объект-литерал перезапускал бы effect на каждый рендер; потребители передают стабильные useCallback (Task 5 так и делает). Риск устаревшего замыкания accepted: onSessionDead читает setState-функции, стабильные по React.
- **I-3 (Task 5):** страницы остаются без DOM-тестов (нет @testing-library/react — deferred T10 батча 4 UI-среза); wiring верифицируется typecheck + ручной приёмкой строки 12.2. Тестируемые швы вынесены в чистые функции (rejoinAsGuest).
- **I-4 (Task 5, screen):** `joinStarted` → `joinInFlight` допускает dev-StrictMode двойной spectator-join в узком окне (первая попытка settled до второго mount); в проде effect одноразовый. Принято ради повторного входа по onSessionDead.
- **I-5 (Task 8):** e2e/*.ts вне typecheck (deferred T16) — lan-конфиг верифицируется эмпирически (`--list` с валидным/невалидным env), валидация логики запинана vitest.
- **I-6 (Task 1):** кейс `auto + test` не тестируется отдельно — NODE_ENV='test' покрыт кейсом development (оба не production); добавление четвёртой строки посчитано избыточным.
- **Review Focus 3 (Task 2, шаг 3):** выбор адреса из цепочки XFF — семантика fastify/proxy-addr; план пинит консистентность (ровно один из двух забанен), а фактический адрес дописывается в комментарий после первого прогона. Если владелец хочет жёсткий пин конкретного адреса — отдельное решение после эмпирики.
