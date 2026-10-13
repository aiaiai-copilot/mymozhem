### Task 6: REST-контур rewards (контроллер + wire-маппинг)

**Files:**
- Create: `packages/core/src/rewards/rewards.controller.ts`
- Modify: `packages/core/src/rewards/rewards.module.ts` (controllers)
- Modify: `packages/core/src/transport/http-exception.filter.ts` (статусы + ветка RewardsError/ContractError)
- Modify: `packages/core/src/index.ts` (barrel += controller не нужен наружу; только если по паттерну)
- Test: `packages/core/src/transport/http-exception.filter.spec.ts` (существующий — кейсы маппинга), `packages/core/src/rewards/rewards.controller.int-spec.ts` (HTTP-путь через fastify inject)

**Interfaces:**
- Consumes: `RewardsService` (Task 5), `createPrizeRequestSchema`/`prizeResponseSchema`/`awardResponseSchema`/`listRewardsResponseSchema` (Task 3), `authenticate(req, tokens)` (transport/authenticate.ts), `TokenService` (AuthModule), прецедент контроллера — `transport/exclude.controller.ts`.
- Produces: эндпоинты `POST /rooms/:roomId/prizes` (201), `GET /rooms/:roomId/rewards`, `POST /rooms/:roomId/awards/:awardId/fulfill`, `POST /rooms/:roomId/awards/:awardId/revoke` (200) — их e2e-приёмка в Task 12.

**REQ:** REQ-RWD-004 (вручение/отзыв — явным действием организатора), REQ-RWD-009 (доступ при COMPLETED), REQ-SEC-006 (наружу ровно {code}).

- [ ] **Step 1: Failing unit — маппинг новых кодов**

В `http-exception.filter.spec.ts` добавить кейсы (форма — по соседним кейсам спека):

```typescript
  it.each([
    ['PRIZE_UNKNOWN', 404],
    ['AWARD_UNKNOWN', 404],
    ['PRIZE_FUND_EXHAUSTED', 409],
    ['REWARD_ALREADY_RESOLVED', 409],
    ['ROOM_NOT_ACTIVE', 409],
  ] as const)('maps rewards error %s to %i with bare {code} body', (code, status) => {
    // по существующему паттерну спека: поймать new PrizeUnknownError(...) /
    // ContractError(code, ...) через filter.catch и проверить reply.status/send
  });
```

(Если спек строит reply-мок хелпером — переиспользовать его; брошенное исключение — соответствующий класс из rewards.errors или `new ContractError(code, 'x')`.)

- [ ] **Step 2: Failing int — HTTP-путь**

`packages/core/src/rewards/rewards.controller.int-spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { APP_FILTER } from '@nestjs/core';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { MembershipModule } from '../membership/membership.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { HttpExceptionFilter } from '../transport/http-exception.filter';
import { TokenService } from '../auth/token.service';
import { RoomService } from '../room/room.service';
import { RoomModule } from '../room/room.module';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { RewardsModule } from './rewards.module';
import { RewardsService } from './rewards.service';

// Если @nestjs/platform-fastify отсутствует в devDeps core — добавить
// (workspace-версия как у apps/server) и зафиксировать в леджере.

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
        ConfigModule, PrismaModule, AppRegistryModule.register([]),
        AuthModule, MembershipModule, RealtimeModule, RoomModule, RewardsModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.listen(0, '127.0.0.1');
    tokens = app.get(TokenService);
    roomService = app.get(RoomService);
    rewards = app.get(RewardsService);
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
  }, 120_000);

  afterAll(async () => { await app.close(); await db.stop(); });
  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE rewards."Award", rewards."Prize", identity."Session", membership."Membership", room."Room" CASCADE',
    );
  });

  // organizerToken — guest-claims, роль ORGANIZER из membership (прецедент
  // transport.e2e-spec.ts:362-367).
  async function orgRoom() {
    const room = await roomService.create(ORG);
    const { accessToken } = await tokens.issueGuestTokens(ORG, room.id);
    return { room, token: accessToken };
  }
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it('POST /rooms/:id/prizes → 201; повтор для PARTICIPANT → 403 ACTOR_NOT_ORGANIZER; невалидное тело → 400 REQUEST_INVALID', async () => {
    const { room, token } = await orgRoom();
    const created = await app.inject({
      method: 'POST', url: `/rooms/${room.id}/prizes`,
      headers: auth(token), payload: { name: 'Приз', quantity: 2 },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Приз', quantity: 2, quantityTotal: 2 });

    const bad = await app.inject({
      method: 'POST', url: `/rooms/${room.id}/prizes`,
      headers: auth(token), payload: { name: '', quantity: 0 },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ code: 'REQUEST_INVALID' });

    const guest = await seedIdentity(db.prisma, { kind: 'GUEST', displayName: 'Не организатор' });
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: guest.id, role: 'PARTICIPANT', joinIp: '127.0.0.1' } });
    const guestToken = (await tokens.issueGuestTokens(guest.id, room.id)).accessToken;
    const forbidden = await app.inject({
      method: 'POST', url: `/rooms/${room.id}/prizes`,
      headers: auth(guestToken), payload: { name: 'Приз', quantity: 1 },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ code: 'ACTOR_NOT_ORGANIZER' });
  });

  it('fulfill/revoke по HTTP: no-op повторного вручения → 200, cross-переход → 409 REWARD_ALREADY_RESOLVED, чужая награда → 404', async () => {
    const { room, token } = await orgRoom();
    await roomService.activate(room.id, ORG); // configure не нужен: комната без app для REST-контура
    const prize = await rewards.createPrize(room.id, ORG, { name: 'Приз', quantity: 1 });
    const winner = await seedIdentity(db.prisma, { kind: 'GUEST', displayName: 'Победитель' });
    await db.prisma.award.create({ data: { roomId: room.id, prizeId: prize.id, winnerId: winner.id, sourceAppId: 'lottery' } });
    const award = await db.prisma.award.findFirstOrThrow({ where: { roomId: room.id } });

    const f1 = await app.inject({ method: 'POST', url: `/rooms/${room.id}/awards/${award.id}/fulfill`, headers: auth(token) });
    expect(f1.statusCode).toBe(200);
    expect(f1.json()).toMatchObject({ id: award.id, status: 'FULFILLED' });
    const f2 = await app.inject({ method: 'POST', url: `/rooms/${room.id}/awards/${award.id}/fulfill`, headers: auth(token) });
    expect(f2.statusCode).toBe(200); // типизированный no-op
    const cross = await app.inject({ method: 'POST', url: `/rooms/${room.id}/awards/${award.id}/revoke`, headers: auth(token) });
    expect(cross.statusCode).toBe(409);
    expect(cross.json()).toEqual({ code: 'REWARD_ALREADY_RESOLVED' });
    const missing = await app.inject({ method: 'POST', url: `/rooms/${room.id}/awards/${crypto.randomUUID()}/fulfill`, headers: auth(token) });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'AWARD_UNKNOWN' });

    const list = await app.inject({ method: 'GET', url: `/rooms/${room.id}/rewards`, headers: auth(token) });
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
```

(Если `roomService.create` требует иных аргументов или activate требует configure — сверить с room.service.ts; комната для REST-контура rewards может оставаться DRAFT/ACTIVE без appId.)

- [ ] **Step 3: Run — RED**

Run: `pnpm --filter @mymozhem/core test -- http-exception && pnpm --filter @mymozhem/core test:int -- rewards.controller`
Expected: FAIL (контроллер не существует; статусы не замаплены).

- [ ] **Step 4: Implement — контроллер**

`packages/core/src/rewards/rewards.controller.ts`:

```typescript
import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import {
  awardResponseSchema,
  createPrizeRequestSchema,
  listRewardsResponseSchema,
  prizeResponseSchema,
  type AwardResponse,
  type PrizeResponse,
} from '@mymozhem/sdk';
import type { Award, Prize } from '@prisma/client';
import { authenticate, type RequestLike } from '../transport/authenticate';
import { TokenService } from '../auth/token.service';
import { RewardsService } from './rewards.service';

// REST-контур управления фондом и наградами (design 2026-09-10 §2): cross-app
// управляющие действия платформенного контура, не внутриигровые команды механики —
// поэтому HTTP с существующими гардами, а не realtime-команды. Проверка роли —
// в домене (RewardsService.assertOrganizer), контроллер статусов не знает.
@Controller('rooms')
export class RewardsController {
  constructor(
    private readonly rewards: RewardsService,
    private readonly tokens: TokenService,
  ) {}

  @Post(':roomId/prizes')
  async createPrize(@Req() req: RequestLike, @Param('roomId') roomId: string): Promise<PrizeResponse> {
    const claims = await authenticate(req, this.tokens);
    const parsedRoomId = z.uuid().parse(roomId);
    const input = createPrizeRequestSchema.parse(req.body ?? {});
    const prize = await this.rewards.createPrize(parsedRoomId, claims.sub, input);
    return prizeResponseSchema.parse(toPrizeResponse(prize));
  }

  @Get(':roomId/rewards')
  async listRewards(@Req() req: RequestLike, @Param('roomId') roomId: string) {
    const claims = await authenticate(req, this.tokens);
    const parsedRoomId = z.uuid().parse(roomId);
    const awards = await this.rewards.listAwards(parsedRoomId, claims.sub);
    return listRewardsResponseSchema.parse({ awards: awards.map(toAwardResponse) });
  }

  @Post(':roomId/awards/:awardId/fulfill')
  @HttpCode(200)
  async fulfill(
    @Req() req: RequestLike,
    @Param('roomId') roomId: string,
    @Param('awardId') awardId: string,
  ): Promise<AwardResponse> {
    const claims = await authenticate(req, this.tokens);
    const award = await this.rewards.fulfill(z.uuid().parse(roomId), z.uuid().parse(awardId), claims.sub);
    return awardResponseSchema.parse(toAwardResponse(award));
  }

  @Post(':roomId/awards/:awardId/revoke')
  @HttpCode(200)
  async revoke(
    @Req() req: RequestLike,
    @Param('roomId') roomId: string,
    @Param('awardId') awardId: string,
  ): Promise<AwardResponse> {
    const claims = await authenticate(req, this.tokens);
    const award = await this.rewards.revoke(z.uuid().parse(roomId), z.uuid().parse(awardId), claims.sub);
    return awardResponseSchema.parse(toAwardResponse(award));
  }
}

function toPrizeResponse(p: Prize): PrizeResponse {
  return {
    id: p.id, roomId: p.roomId, name: p.name,
    quantityTotal: p.quantityTotal, quantity: p.quantity,
    createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
  };
}

function toAwardResponse(a: Award): AwardResponse {
  return {
    id: a.id, roomId: a.roomId, prizeId: a.prizeId, winnerId: a.winnerId,
    status: a.status, sourceAppId: a.sourceAppId,
    createdAt: a.createdAt.toISOString(),
    fulfilledAt: a.fulfilledAt?.toISOString() ?? null,
    revokedAt: a.revokedAt?.toISOString() ?? null,
  };
}
```

(Точные имена `RequestLike`/сигнатуру `authenticate` сверить с `transport/authenticate.ts` и `exclude.controller.ts`; если body у RequestLike не типизирован — `(req as { body?: unknown }).body`.) Ответная `.parse` на границе — прецедент follow-up OAuth-среза (`createRoomResponseSchema.parse`); парсинг ответа приводит Date→ISO и отсекает лишние поля.

`rewards.module.ts`: `imports: [..., AuthModule]`, `controllers: [RewardsController]`. (AuthModule экспортирует TokenService — прецедент transport.module.ts:20.)

- [ ] **Step 5: Implement — wire-маппинг**

`http-exception.filter.ts`, в `STATUS_BY_WIRE_CODE` перед `INTERNAL_ERROR`:

```typescript
  // Фаза 3 (design 2026-09-10 §2): REST-контур rewards.
  ROOM_NOT_ACTIVE: 409,
  PRIZE_UNKNOWN: 404,
  AWARD_UNKNOWN: 404,
  PRIZE_FUND_EXHAUSTED: 409,
  REWARD_ALREADY_RESOLVED: 409,
```

В `toWireCode` — ветка после `RoomError` (до ZodError):

```typescript
    // Ошибки контракта с wire-паритетом кода (rewards ф.3 и далее): класс-
    // специфичные ветки выше сохраняют свои правила свёртки; сюда попадают
    // ContractError'ы, коды которых сознательно добавлены в STATUS_BY_WIRE_CODE.
    if (exception instanceof ContractError && exception.code in STATUS_BY_WIRE_CODE) {
      return exception.code as WireCode;
    }
```

(импорт `ContractError` из `@mymozhem/sdk`.)

- [ ] **Step 6: Run — GREEN**

Run: `pnpm --filter @mymozhem/sdk build && pnpm build && pnpm --filter @mymozhem/core test -- http-exception && pnpm --filter @mymozhem/core test:int -- rewards`
Expected: PASS. Полная лана core: `pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core test:int`.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/rewards packages/core/src/transport packages/core/package.json pnpm-lock.yaml packages/core/src/index.ts
git commit -m "feat(core): REST-контур rewards — prizes/rewards/fulfill/revoke, wire-маппинг кодов фазы 3

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

**Конец Batch B.** Зелёный конвейер батча: `pnpm build && pnpm lint && pnpm boundary-check && pnpm guardrails && pnpm test && pnpm test:int`. Дальше — новой сессией.

---
