### Task 5: Транспорт — rooms-lifecycle, members, prizes-list

**Files:**
- Create: `packages/core/src/transport/rooms-lifecycle.controller.ts`
- Create: `packages/core/src/transport/members.controller.ts`
- Modify: `packages/core/src/rewards/rewards.controller.ts` (+= GET `:roomId/prizes`)
- Modify: `packages/core/src/rewards/rewards.service.ts` (+= `listPrizes(roomId, actorId)` с `assertOrganizer`, зеркало `listAwards`)
- Modify: `packages/core/src/transport/transport.module.ts` (controllers += 2)
- Test: `packages/core/src/transport/rooms-lifecycle.controller.int-spec.ts`, `packages/core/src/transport/members.controller.int-spec.ts`; += кейс в `packages/core/src/rewards/rewards.controller.int-spec.ts`

**Interfaces:**
- Consumes: Task 3 (схемы), Task 4 (asserts), `RoomService.configure/activate/complete/cancel`, `authenticate(req, tokens)` (прецедент `rooms.controller.ts`), `createRoomResponseSchema`.
- Produces: `POST /rooms/:roomId/configure|activate|complete|cancel` (organizer-only, ответ `CreateRoomResponse`); `GET /rooms/:roomId/members` (любой член, `RosterResponse`); `GET /rooms/:roomId/prizes` (organizer, `ListPrizesResponse`).

- [ ] **Step 1: Failing int-tests** (паттерн `rewards.controller.int-spec.ts`: testcontainers, сидирование через сервисы, HTTP через `app.inject`)

rooms-lifecycle:
```ts
it('configure happy: organizer sets quiz settings in DRAFT → 200, echo status DRAFT')
it('configure with {} for lottery app passes the gate (P1 end-to-end, REQ-RWD-014)')
it('configure as PARTICIPANT → 403 ACTOR_NOT_ORGANIZER')
it('configure without token → 401')
it('activate → 200 ACTIVE + core.room.activated в логе; повторный activate → ROOM_TRANSITION_INVALID')
it('complete after ACTIVE → 200 COMPLETED; cancel from DRAFT → 200 CANCELLED')
it('activate after complete → ROOM_TRANSITION_INVALID (REQ-RT-005)')
```
members:
```ts
it('roster: organizer+participant+spectator видны всем членам, роли lowercase')
it('swept guest — displayName null в ростере')
it('non-member (гость другой комнаты) → 403 ACTOR_NOT_MEMBER')
it('no token → 401')
```
rewards += :
```ts
it('GET prizes: organizer видит список с quantity/quantityTotal; participant → 403')
```

- [ ] **Step 2: Run red** — `pnpm --filter @mymozhem/core test:int` → FAIL (404/методов нет)

- [ ] **Step 3: Implement controllers**

```ts
// rooms-lifecycle.controller.ts
import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { configureRoomRequestSchema, createRoomResponseSchema, type CreateRoomResponse } from '@mymozhem/sdk';
import type { Room } from '@prisma/client';
import { authenticate } from './authenticate';
import type { RequestLike } from './http.types';
import { TokenService } from '../auth/token.service';
import { RoomService } from '../room/room.service';
import { MembershipService } from '../membership/membership.service';

// HTTP-контур lifecycle комнаты (дизайн UI-среза, решение №9): до среза configure/
// activate/complete/cancel существовали только сервисным путём. Проверка роли — в
// домене (membership.assertOrganizer) до операции; actorId перехода — из access JWT
// (REQ-RT-009 по духу HTTP). Ответная .parse на границе — прецедент RoomsController.
@Controller('rooms')
export class RoomsLifecycleController {
  constructor(
    private readonly rooms: RoomService,
    private readonly membership: MembershipService,
    private readonly tokens: TokenService,
  ) {}

  @Post(':roomId/configure')
  async configure(@Req() req: RequestLike, @Param('roomId') roomId: string, @Body() body: unknown): Promise<CreateRoomResponse> {
    const claims = authenticate(req, this.tokens);
    const id = z.uuid().parse(roomId);
    await this.membership.assertOrganizer(id, claims.sub);
    const input = configureRoomRequestSchema.parse(body ?? {});
    return createRoomResponseSchema.parse(toRoomResponse(await this.rooms.configure(id, input)));
  }

  @Post(':roomId/activate')
  async activate(@Req() req: RequestLike, @Param('roomId') roomId: string): Promise<CreateRoomResponse> {
    return this.transition(req, roomId, (r, actor) => this.rooms.activate(r, actor));
  }

  @Post(':roomId/complete')
  async complete(@Req() req: RequestLike, @Param('roomId') roomId: string): Promise<CreateRoomResponse> {
    return this.transition(req, roomId, (r, actor) => this.rooms.complete(r, actor));
  }

  @Post(':roomId/cancel')
  async cancel(@Req() req: RequestLike, @Param('roomId') roomId: string): Promise<CreateRoomResponse> {
    return this.transition(req, roomId, (r, actor) => this.rooms.cancel(r, actor));
  }

  private async transition(
    req: RequestLike,
    roomId: string,
    op: (roomId: string, actorId: string) => Promise<Room>,
  ): Promise<CreateRoomResponse> {
    const claims = authenticate(req, this.tokens);
    const id = z.uuid().parse(roomId);
    await this.membership.assertOrganizer(id, claims.sub);
    return createRoomResponseSchema.parse(toRoomResponse(await op(id, claims.sub)));
  }
}

// Prisma-enum uppercase ('GUESTS') → SDK-lowercase ('guests') — @map-разрыв, тот же,
// что echo в RoomsController.create (здесь echo невозможен: входа joinPolicy нет).
const toRoomResponse = (room: Room): CreateRoomResponse => ({
  roomId: room.id,
  code: room.code,
  joinPolicy: room.joinPolicy.toLowerCase() as CreateRoomResponse['joinPolicy'],
  status: room.status,
});
```

```ts
// members.controller.ts
import { Controller, Get, Param, Req } from '@nestjs/common';
import { z } from 'zod';
import { rosterResponseSchema, type RosterResponse } from '@mymozhem/sdk';
import { authenticate } from './authenticate';
import type { RequestLike } from './http.types';
import { TokenService } from '../auth/token.service';
import { MembershipService } from '../membership/membership.service';

// Ростер комнаты (дизайн UI-среза, решение №10): любой активный член; displayName
// null после TTL-свипа; Prisma-роль uppercase → wire lowercase (прецедент join).
@Controller('rooms')
export class MembersController {
  constructor(
    private readonly membership: MembershipService,
    private readonly tokens: TokenService,
  ) {}

  @Get(':roomId/members')
  async list(@Req() req: RequestLike, @Param('roomId') roomId: string): Promise<RosterResponse> {
    const claims = authenticate(req, this.tokens);
    const id = z.uuid().parse(roomId);
    await this.membership.assertMember(id, claims.sub);
    const roster = await this.membership.listRoster(id);
    return rosterResponseSchema.parse({
      members: roster.map((m) => ({
        identityId: m.identityId,
        displayName: m.displayName,
        role: m.role.toLowerCase() as RosterResponse['members'][number]['role'],
      })),
    });
  }
}
```

rewards.controller += (зеркало listRewards):
```ts
  @Get(':roomId/prizes')
  async listPrizes(@Req() req: RequestLike, @Param('roomId') roomId: string): Promise<ListPrizesResponse> {
    const claims = authenticate(req, this.tokens);
    const prizes = await this.rewards.listPrizes(z.uuid().parse(roomId), claims.sub);
    return listPrizesResponseSchema.parse({ prizes: prizes.map(toPrizeResponse) });
  }
```
rewards.service += `listPrizes(roomId, actorId)` = `assertOrganizer` + `prize.findMany({ where: { roomId } })` (зеркало listAwards; сигнатуру сверить с ним).

transport.module.ts: `controllers: [..., RoomsLifecycleController, MembersController]` + импорты.

- [ ] **Step 4: Run green** — `pnpm build && pnpm --filter @mymozhem/core test:int` зелёный; затем e2e apps/server (новые контроллеры в реальном AppModule): `pnpm --filter @mymozhem/server test` зелёный

- [ ] **Step 5: Commit** — `feat(core): HTTP-контур lifecycle/configure + ростер + список призов (UI-срез, решения №9/№10)`

---

## Батч B — scaffold web и клиентский слой

