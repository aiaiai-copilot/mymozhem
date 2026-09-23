# UI-срез MyMozhem — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Первое живое событие проводится целиком через UI: SPA `apps/web` (организатор / участник / проектор) поверх существующего backend'а, плюс недостающие backend-контуры (lifecycle/configure по HTTP, ростер, список призов) и два pre-task'а из решений ф.3 (SDK io:'input', фильтр deletedAt в drawPool).

**Architecture:** Один SPA (Vite+React+TS) в `apps/web`, раздаётся Fastify same-origin из единого Docker-артефакта (CORS не включается). Клиентское состояние — фолд snapshot+live событий realtime-подписки через те же чистые редьюсеры `@mymozhem/app-quiz`/`@mymozhem/app-lottery`, что на сервере; REST — typed-клиент с zod-валидацией из `@mymozhem/sdk`. Подход A — временное решение MVP (дизайн §0.7): выделение `@mymozhem/client-sdk` — задел платформенной фазы.

**Tech Stack:** React 18, Vite, react-router 6, socket.io-client 4, vitest, Playwright; backend: NestJS/Fastify, zod 4, Prisma (testcontainers для int).

**Spec:** `docs/sessions/2026-09-23-ui-slice-design.md` (§0 — 10 решений владельца, обязательны к прочтению перед исполнением).

**Закрываемые REQ-\*:** REQ-RWD-014 (P1), REQ-RT-004/005/006/009/010/011a, REQ-ID-003/008/011/016, REQ-CORE-004/007/008, REQ-CTR-002/004/005, REQ-SEC-001/006/009, REQ-DEV-001/002/003, REQ-OPS-003/005. (Ревью спек-комплаенса сверяется с этим списком и дизайном.)

## Global Constraints

- Node >= 24, pnpm 11 workspaces + turbo; **один lockfile** (REQ-DEV-002) — зависимости только через `pnpm add` в корне workspace.
- Границы принуждаются машиной (REQ-DEV-001): новые depcruise-правила + живые probe'ы в guardrails — часть Task 6, не отдельный follow-up.
- TDD: тест первым, красный прогон, минимальная реализация, зелёный прогон, коммит. Коммит после каждой задачи.
- **Никогда не запускать тесты против production** — Playwright только против локального docker-compose стенда.
- Комментарии в коде — по-русски, в стиле репозитория (почему, а не что); wire-имена событий app-модулей — dotted-lowercase.
- Никакого глобального мутабельного состояния процесса на сервере (REQ-CORE-004); actorId — только из access JWT (REQ-RT-009 по духу HTTP).
- `Math.random` запрещён в `packages/app-*` (REQ-RWD-011); в web для uuid — только `crypto.randomUUID()`.
- apps/server e2e резолвит `@mymozhem/core` из dist — после правок core/sdk: `pnpm build` до e2e/int прогонов.
- Postgres aborted-tx ловушка (HANDOFF): catch unique-violation внутри tx отравляет её — в задачах среза tx-кода нет, но глаза открыты.
- Прогон int-ланы поднимает testcontainers — Docker/OrbStack запущен.

## Review Focus

1. **JWT-декод на клиенте без верификации** — только для UI («кто я»), никогда для решений доступа; ожидание: подделанный payload не даёт прав (все гейты серверные). Тест — Task 10 шаг 1.
2. **Ростер устаревает** (join не эмитит событий) — ожидание: рефетч на subscribe и на событиях reveal/finish/draw.completed. Тест — Task 9 шаг 3 (`shouldRefetchRoster`).
3. **Дуп события из окна handshake** (wire без id/seq) — ожидание: применён дважды, состояние самолечится re-subscribe; принятое поведение запинано, не «исправлено» молча. Тест — Task 9 шаг 1.
4. **401-шторм**: ровно один refresh + один retry, повторный 401 → ApiError, не цикл. Тест — Task 7 шаг 1.
5. **SPA-fallback отдаёт index.html на API-404** — ожидание: неизвестный API-путь → JSON 404, index.html только для не-API GET. Тест — Task 6 шаг 6.

---

## Батч A — backend pre-tasks и транспорт

### Task 1: SDK io:'input' (P1, C-9.1) → SDK 1.7.0

**Files:**
- Modify: `packages/sdk/src/manifest/define-app.ts` (toRegisteredSchema)
- Modify: `packages/sdk/src/contract-version.ts` (`CONTRACT_VERSION`)
- Modify: `packages/sdk/package.json` (`version`)
- Test: `packages/sdk/src/manifest/define-app.spec.ts` (существующий; если имя иное — найти по `toRegisteredSchema`/`defineApp` в `packages/sdk/src/manifest/`)
- Test: `packages/core/src/app-registry/app-registry.service.spec.ts` (существующий unit спека validateSettings; найти по `validateSettings`)

**Interfaces:**
- Consumes: `z.toJSONSchema(schema, { io: 'input', override })` — zod 4; defaulted ключи в input-режиме не попадают в `required`.
- Produces: артефакт манифеста, где defaulted ключи appSettings необязательны (configure `{}` проходит verdict-only гейт); SDK/контракт 1.7.0.

- [ ] **Step 1: Failing test — defaulted ключ необязателен в артефакте, аннотации видимости сохраняются**

```ts
it('defaulted settings key is optional in the registered artifact (io: input, C-9.1)', () => {
  const manifest = defineApp({
    appId: 'fixture-defaults',
    manifestVersion: 1,
    appSettings: z.strictObject({
      mode: z.string().default('relaxed').meta({ 'x-visibility': 'public' }),
      requiredKey: z.string().meta({ 'x-visibility': 'public' }),
    }),
    events: {},
  });
  const artifact = manifest.appSettings as {
    required?: string[];
    properties: Record<string, Record<string, unknown>>;
  };
  expect(artifact.required).toEqual(['requiredKey']);
  expect(artifact.properties.mode.default).toBe('relaxed');
  expect(artifact.properties.mode['x-visibility']).toBe('public');
});
```

- [ ] **Step 2: Run** — `pnpm --filter @mymozhem/sdk test -- define-app` → FAIL (`required` содержит `mode`)

- [ ] **Step 3: Implement** — в `toRegisteredSchema` добавить `io: 'input'`:

```ts
    const json = z.toJSONSchema(schema, {
      // input-режим (решение владельца C-9.1, REQ-RWD-014): defaulted ключи — необязательные
      // на входе; дефолт применяет zod-parse в handler'е модуля, гейт ядра verdict-only.
      io: 'input',
      override: (ctx) => { /* без изменений */ },
    });
```

- [ ] **Step 4: Bump контракта** — `CONTRACT_VERSION = '1.7.0'`; `packages/sdk/package.json` `"version": "1.7.0"` (контрактный тест пинит равенство). Прогнать `pnpm --filter @mymozhem/sdk test` — зелёный; контрактные спеки quiz/lottery, пинившие output-режим (`required` с defaulted ключом, напр. `drawEligibility`), поправить под input-режим.

- [ ] **Step 5: Failing test (core)** — `validateSettings` принимает `{}` для манифеста с defaulted настройками:

```ts
it('accepts {} when every settings key is defaulted (C-9.1 end-to-end на гейте)', () => {
  const registry = new AppRegistryService([fixtureManifestWithDefaultedSettings]);
  expect(() => registry.validateSettings('fixture-defaults', 1, {})).not.toThrow();
});
```

- [ ] **Step 6: Run red → уже зелёный после Step 3? Если зелёный сразу — значит гейт читает тот же артефакт (ожидаемо); оставить тест как пин. Прогнать полный unit конвейер:** `pnpm build && pnpm run test` → зелёный.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk packages/core packages/app-quiz packages/app-lottery
git commit -m "feat(sdk): toRegisteredSchema в io:'input' — defaulted ключи appSettings необязательны (C-9.1, REQ-RWD-014); контракт 1.7.0"
```

### Task 2: drawPool — фильтр swept-гостей (P2)

**Files:**
- Modify: `packages/core/src/membership/membership.service.ts:144-155` (`listActiveParticipantPool`)
- Test: int-спека, покрывающая `listActiveParticipantPool` (найти: `grep -rn "listActiveParticipantPool" packages/core/src --include="*.int-spec.ts"`)

**Interfaces:**
- Produces: пул розыгрыша исключает identity с `deletedAt != null` (TTL-истёкшие гости).

- [ ] **Step 1: Failing test**

```ts
it('excludes swept (anonymized) guests from the draw pool (P2)', async () => {
  // arrange: комната + два PARTICIPANT-гостя (паттерн существующих кейсов пула)
  await prisma.identity.update({
    where: { id: sweptGuestId },
    data: { deletedAt: new Date(), displayName: null },
  });
  const pool = await membership.listActiveParticipantPool(roomId);
  expect(pool.map((p) => p.identityId)).toEqual([aliveGuestId]);
});
```

- [ ] **Step 2: Run** — `pnpm --filter @mymozhem/core test:int -- membership` → FAIL (swept-гость в пуле)

- [ ] **Step 3: Implement** — в `where` добавить `identity: { deletedAt: null }`:

```ts
      where: {
        roomId,
        role: 'PARTICIPANT',
        deletedAt: null,
        room: { deletedAt: null },
        identity: { deletedAt: null }, // P2: swept-гость (TTL-анонимизация) вне пула розыгрыша
      },
```

- [ ] **Step 4: Run** — тот же прогон зелёный + полный `pnpm --filter @mymozhem/core test:int`

- [ ] **Step 5: Commit** — `fix(core): drawPool исключает swept-гостей (identity.deletedAt) — решение владельца P2`

### Task 3: SDK wire-схемы — configure-request, ростер, список призов

**Files:**
- Create: `packages/sdk/src/room/configure-room-request.ts`
- Create: `packages/sdk/src/membership/roster-entry.ts`
- Create: `packages/sdk/src/rewards/list-prizes-response.ts`
- Modify: `packages/sdk/src/index.ts` (экспорты)
- Test: `packages/sdk/src/room/configure-room-request.contract.spec.ts`, `packages/sdk/src/membership/roster-entry.contract.spec.ts`, `packages/sdk/src/rewards/list-prizes-response.contract.spec.ts`

**Interfaces:**
- Produces (потребляются Task 5 и web-клиентом): `configureRoomRequestSchema`, `ConfigureRoomRequest`; `rosterRoleSchema`, `rosterEntrySchema`, `rosterResponseSchema`, `RosterEntry`, `RosterResponse`; `listPrizesResponseSchema`, `ListPrizesResponse`.

- [ ] **Step 1: Failing tests** (по прецеденту существующих contract-спек: валидный кейс парсится, лишний ключ отклоняется, строгость типов)

```ts
// configure-room-request.contract.spec.ts
it.each([
  ['valid', { appId: 'quiz', manifestVersion: 2, settings: { questions: [] } }, true],
  ['extra key rejected', { appId: 'quiz', manifestVersion: 2, settings: {}, extra: 1 }, false],
  ['settings must be object', { appId: 'quiz', manifestVersion: 2, settings: 'x' }, false],
  ['bad appId', { appId: 'QUIZ!', manifestVersion: 2, settings: {} }, false],
])('%s', (_l, body, ok) => {
  expect(configureRoomRequestSchema.safeParse(body).success).toBe(ok);
});

// roster-entry.contract.spec.ts
it.each([
  ['valid', { identityId: crypto.randomUUID(), displayName: 'Гость', role: 'participant' }, true],
  ['swept guest — displayName null', { identityId: crypto.randomUUID(), displayName: null, role: 'participant' }, true],
  ['uppercase role rejected (wire lowercase)', { identityId: crypto.randomUUID(), displayName: 'x', role: 'PARTICIPANT' }, false],
  ['extra key rejected', { identityId: crypto.randomUUID(), displayName: 'x', role: 'organizer', extra: 1 }, false],
])('%s', (_l, entry, ok) => {
  expect(rosterEntrySchema.safeParse(entry).success).toBe(ok);
});

// list-prizes-response.contract.spec.ts — { prizes: PrizeResponse[] }, пустой массив валиден
```

- [ ] **Step 2: Run** — `pnpm --filter @mymozhem/sdk test` → FAIL (нет экспортов)

- [ ] **Step 3: Implement**

```ts
// configure-room-request.ts
import { z } from 'zod';
import { appIdSchema } from '../events/event-type';

// POST /rooms/:roomId/configure (дизайн UI-среза, решение №9). settings — JSON-объект
// appSettings: семантическую валидацию делает app-registry (REQ-CORE-007), здесь — форма.
export const configureRoomRequestSchema = z.strictObject({
  appId: appIdSchema,
  manifestVersion: z.number().int().positive(),
  settings: z.record(z.string(), z.unknown()),
});
export type ConfigureRoomRequest = z.infer<typeof configureRoomRequestSchema>;
```

```ts
// roster-entry.ts
import { z } from 'zod';

// GET /rooms/:roomId/members (дизайн UI-среза, решение №10): ростер — read-контур;
// в лог displayName не пишется (REQ-SEC-009 касается событий). displayName nullable —
// TTL-свип анонимизирует гостя, membership при этом жив. Wire-роли lowercase —
// прецедент JoinRequest ('participant' | 'spectator').
export const rosterRoleSchema = z.enum(['organizer', 'moderator', 'participant', 'spectator']);
export type RosterRole = z.infer<typeof rosterRoleSchema>;

export const rosterEntrySchema = z.strictObject({
  identityId: z.uuid(),
  displayName: z.string().nullable(),
  role: rosterRoleSchema,
});
export type RosterEntry = z.infer<typeof rosterEntrySchema>;

export const rosterResponseSchema = z.strictObject({ members: z.array(rosterEntrySchema) });
export type RosterResponse = z.infer<typeof rosterResponseSchema>;
```

```ts
// list-prizes-response.ts
import { z } from 'zod';
import { prizeResponseSchema } from './prize-response';

// GET /rooms/:id/prizes (дизайн UI-среза §2): консоли нужны prizeId и остаток фонда.
export const listPrizesResponseSchema = z.strictObject({ prizes: z.array(prizeResponseSchema) });
export type ListPrizesResponse = z.infer<typeof listPrizesResponseSchema>;
```

Плюс три строки экспорта в `index.ts`.

- [ ] **Step 4: Run** — `pnpm --filter @mymozhem/sdk test && pnpm --filter @mymozhem/sdk build` → зелёный

- [ ] **Step 5: Commit** — `feat(sdk): wire-схемы configure-room-request, roster, list-prizes (UI-срез, решения №9/№10)`

### Task 4: MembershipService — assertMember/assertOrganizer/listRoster

**Files:**
- Modify: `packages/core/src/membership/membership.service.ts`
- Test: `packages/core/src/membership/membership.int-spec.ts` (существующая int-спека membership; найти по `findActiveMembership`)

**Interfaces:**
- Consumes: `findActiveMembership(roomId, identityId)`, `ActorNotMemberError`, `ActorNotOrganizerError` (оба в `./membership.errors`).
- Produces: `assertMember(roomId, identityId): Promise<Membership>`, `assertOrganizer(roomId, identityId): Promise<Membership>`, `listRoster(roomId): Promise<{ identityId: string; displayName: string | null; role: MemberRole }[]>` — потребители: Task 5.

- [ ] **Step 1: Failing tests**

```ts
it('assertMember throws ActorNotMemberError for non-member, returns membership for member', ...)
it('assertOrganizer throws ActorNotOrganizerError for PARTICIPANT, passes for ORGANIZER', ...)
it('listRoster returns active members with identity displayName (null after sweep)', async () => {
  // организатор + гость + swept-гость (displayName null) + исключённый (deletedAt membership) —
  // исключённого нет, swept с null-именем есть
});
```

- [ ] **Step 2: Run red** — `pnpm --filter @mymozhem/core test:int -- membership` → FAIL (методов нет)

- [ ] **Step 3: Implement**

```ts
  // Актор — активный член комнаты любой роли (UI-срез: ростер, решение №10).
  async assertMember(roomId: string, identityId: string): Promise<Membership> {
    const m = await this.findActiveMembership(roomId, identityId);
    if (!m) {
      throw new ActorNotMemberError(`identity ${identityId} is not an active member of room ${roomId}`);
    }
    return m;
  }

  // Актор — ORGANIZER комнаты (UI-срез: lifecycle-контур, решение №9).
  async assertOrganizer(roomId: string, identityId: string): Promise<Membership> {
    const m = await this.assertMember(roomId, identityId);
    if (m.role !== 'ORGANIZER') {
      throw new ActorNotOrganizerError(`identity ${identityId} is not organizer of room ${roomId}`);
    }
    return m;
  }

  // Ростер комнаты: активные membership'ы; displayName null после TTL-свипа (решение №10).
  async listRoster(roomId: string): Promise<{ identityId: string; displayName: string | null; role: MemberRole }[]> {
    const rows = await this.prisma.membership.findMany({
      where: { roomId, deletedAt: null, room: { deletedAt: null } },
      select: { identityId: true, role: true, identity: { select: { displayName: true } } },
    });
    return rows.map((r) => ({ identityId: r.identityId, displayName: r.identity.displayName, role: r.role }));
  }
```

(`Membership`, `MemberRole` — Prisma-типы, уже импортируемые или добавить импорт; следовать стилю файла.)

- [ ] **Step 4: Run green** — тот же прогон + полный int core

- [ ] **Step 5: Commit** — `feat(core): MembershipService — assertMember/assertOrganizer/listRoster (UI-срез)`

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

### Task 6: apps/web scaffold + boundary + static-serving + compose

**Files:**
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`
- Modify: `.dependency-cruiser.cjs` (2 правила), `scripts/verify-guardrails.mjs` (2 probe), `packages/core/src/config/config.schema.ts` (`WEB_STATIC_DIR`), `apps/server/src/main.ts` (static + SPA-fallback), `apps/server/package.json` (`@fastify/static`), `docker-compose.yml` (`WEB_STATIC_DIR`)
- Test: `apps/server/test/static-web.e2e-spec.ts`

**Interfaces:**
- Produces: workspace-пакет `@mymozhem/web` с turbo-тасками build/lint/typecheck/test; boundary-правила `web-only-through-sdk-and-app-packages`, `web-socketio-only-in-realtime`; прод-раздача SPA при заданном `WEB_STATIC_DIR`.

- [ ] **Step 1: Scaffold** — package.json:

```json
{
  "name": "@mymozhem/web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Зависимости — только через pnpm (точные версии зафиксирует lockfile, REQ-DEV-002):
```bash
pnpm --filter @mymozhem/web add react react-dom react-router-dom socket.io-client zod @mymozhem/sdk@workspace:* @mymozhem/app-quiz@workspace:* @mymozhem/app-lottery@workspace:*
pnpm --filter @mymozhem/web add -D vite @vitejs/plugin-react typescript vitest @types/react @types/react-dom
pnpm --filter @mymozhem/server add @fastify/static
```

vite.config.ts:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dev-proxy: браузер видит same-origin (дизайн §2) — CORS не нужен ни в dev, ни в проде.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/rooms': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  test: { environment: 'node', include: ['src/**/*.spec.ts'] },
});
```

tsconfig.json — extends `../../tsconfig.base.json`, `compilerOptions: { "jsx": "react-jsx", "module": "ESNext", "moduleResolution": "bundler", "types": ["vite/client"], "noEmit": true }`, `include: ["src"]`. (Поля базового конфига не дублировать; если конфликт — следовать базовому.)

index.html — `<div id="root"></div>` + `<script type="module" src="/src/main.tsx">`, `<meta name="viewport" content="width=device-width, initial-scale=1">` (mobile-first, дизайн §0.4).

main.tsx / App.tsx — router с 4 маршрутами-заглушками (`/`, `/host/*`, `/play/:code?`, `/screen/:code` → `<p>tbd</p>`; реальные страницы — батчи C/D). styles.css — минимальный reset.

- [ ] **Step 2: Boundary-правила** — в `.dependency-cruiser.cjs` после `app-only-through-sdk`:

```js
{
  name: 'web-only-through-sdk-and-app-packages',
  severity: 'error',
  comment: 'apps/web видит только контракт (sdk) и чистые app-пакеты; core — за границей (ADR-002).',
  from: { path: '^apps/web/src' },
  to: { path: '^packages/', pathNot: ['^packages/sdk/', '^packages/app-quiz/', '^packages/app-lottery/'] },
},
{
  name: 'web-socketio-only-in-realtime',
  severity: 'error',
  comment: 'socket.io-client — только в apps/web/src/realtime (зеркало REQ-RT-006 на клиенте).',
  from: { path: '^apps/web/src', pathNot: '^apps/web/src/realtime' },
  to: { path: 'node_modules/socket[.]io-client' },
},
```

Проверить, что depcruise парсит .tsx (конфиг уже круизит TS; при необходимости — минимальная правка options). `pnpm run boundary-check` зелёный.

- [ ] **Step 3: Guardrails probes** — в `verify-guardrails.mjs` по существующему паттерну (writeFileSync → expectFailure → rmSync в finally):

```js
// 6) Web-boundary probe: apps/web импортирует core (forbidden).
// 7) Web-socket probe: socket.io-client вне src/realtime (forbidden).
//    Обоим — относительные импорты/прямой пакетный spec по прецеденту probes 3–5.
```

`pnpm run guardrails` — оба probe'а firing.

- [ ] **Step 4: config** — `WEB_STATIC_DIR: z.string().min(1).optional()` в config.schema.ts с комментарием (UI-срез: same-origin SPA; не задан → статика не раздаётся, поведение прежнее).

- [ ] **Step 5: Failing e2e static-serving** — `apps/server/test/static-web.e2e-spec.ts` (паттерн transport.e2e: поднять app с конфиг-override `WEB_STATIC_DIR` на tmp-директорию с index.html-маркером):

```ts
it('GET / → index.html (SPA)')
it('GET /host/console (не-API GET) → index.html (SPA fallback)')
it('GET /rooms/nonexistent (API-путь) → JSON 404, НЕ index.html')
it('GET /socket.io/... → не index.html')
```

- [ ] **Step 6: Run red → implement main.ts** (после регистрации CORS, до listen):

```ts
  // UI-срез (дизайн §2): same-origin раздача SPA из того же Docker-артефакта.
  // WEB_STATIC_DIR не задан → статики нет, поведение прежнее (dev/test).
  if (config.WEB_STATIC_DIR) {
    await app.register(fastifyStatic, { root: config.WEB_STATIC_DIR });
    // SPA-fallback только для не-API GET: API-404 обязаны оставаться JSON (Review Focus 5).
    const API_PREFIXES = ['/rooms', '/auth', '/health', '/socket.io'];
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? '';
      if (req.raw.method === 'GET' && !API_PREFIXES.some((p) => url.startsWith(p))) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ code: 'NOT_FOUND' });
    });
  }
```

Run green: `pnpm build && pnpm --filter @mymozhem/server test -- static-web`.

- [ ] **Step 7: compose + turbo** — `docker-compose.yml` server.environment += `WEB_STATIC_DIR: /app/apps/web/dist`. Dockerfile не меняется (build-стейдж `pnpm run build` собирает web турбо-таской; runtime копирует весь /app). Проверить `pnpm run build && pnpm run typecheck && pnpm run lint` — зелёные с новым пакетом.

- [ ] **Step 8: Commit** — `feat(web): scaffold apps/web (Vite+React) + boundary-правила + same-origin static-serving (UI-срез)`

### Task 7: API-клиент (`src/api/`)

**Files:**
- Create: `apps/web/src/api/api-error.ts`, `apps/web/src/api/token-provider.ts`, `apps/web/src/api/api-client.ts`, `apps/web/src/api/endpoints.ts`
- Test: `apps/web/src/api/api-client.spec.ts`

**Interfaces:**
- Produces (потребители — все страницы): `ApiError { code: string; status: number }`; `TokenProvider { getAccessToken(): string | null; refresh(): Promise<void> }`; `ApiClient.call<S extends z.ZodType>(req: { method: 'GET'|'POST'; path: string; body?: unknown; schema: S; auth?: boolean }): Promise<z.output<S>>`; endpoints: `joinRoom, refreshSession, createRoom, configureRoom, activateRoom, completeRoom, cancelRoom, listMembers, listPrizes, createPrize, listRewards, fulfillAward, revokeAward, excludeMember` — все `(client: ApiClient, ...args)`.

- [ ] **Step 1: Failing tests** (`vi.stubGlobal('fetch', ...)`):

```ts
it('parses ok response with the schema (fail-loud on drift)') // schema mismatch → throws ZodError
it('401 → one refresh → one retry with the new token') // fetch 2 раза, 2-й с новым Bearer
it('second 401 → ApiError, no infinite retry (Review Focus 4)')
it('error body { code } → ApiError with that code; без code → HTTP_<status>')
it('auth:false не шлёт authorization и не делает refresh при 401')
```

- [ ] **Step 2: Run red** — `pnpm --filter @mymozhem/web test` → FAIL

- [ ] **Step 3: Implement** — api-client.ts:

```ts
import { z } from 'zod';
import { ApiError } from './api-error';
import type { TokenProvider } from './token-provider';

// Тонкий typed REST-клиент (дизайн §3): zod-валидация ответов fail-loud при дрейфе
// контракта; серверные ошибки — { code } (REQ-SEC-006); 401 → один refresh → один
// retry (ровно один — Review Focus 4).
export interface ApiRequest<S extends z.ZodType> {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  schema: S;
  auth?: boolean; // default true
}

export class ApiClient {
  constructor(private readonly tokens: TokenProvider) {}

  async call<S extends z.ZodType>(req: ApiRequest<S>, allowRetry = true): Promise<z.output<S>> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = this.tokens.getAccessToken();
    if (req.auth !== false && token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(req.path, {
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      credentials: 'same-origin', // refresh-кука Strict — только same-origin (дизайн §0.3)
    });
    if (res.status === 401 && req.auth !== false && allowRetry) {
      await this.tokens.refresh();
      return this.call(req, false);
    }
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = (json as { code?: unknown }).code;
      throw new ApiError(typeof code === 'string' ? code : `HTTP_${res.status}`, res.status);
    }
    return req.schema.parse(json);
  }
}
```

endpoints.ts — обёртки над SDK-схемами (пример; остальные по той же форме):

```ts
export const joinRoom = (c: ApiClient, input: JoinRequest): Promise<TokenResponse> =>
  c.call({ method: 'POST', path: '/rooms/join', body: input, schema: tokenResponseSchema, auth: false });
export const refreshSession = (c: ApiClient): Promise<TokenResponse> =>
  c.call({ method: 'POST', path: '/auth/refresh', schema: tokenResponseSchema, auth: false });
export const configureRoom = (c: ApiClient, roomId: string, input: ConfigureRoomRequest): Promise<CreateRoomResponse> =>
  c.call({ method: 'POST', path: `/rooms/${roomId}/configure`, body: input, schema: createRoomResponseSchema });
export const listMembers = (c: ApiClient, roomId: string): Promise<RosterResponse> =>
  c.call({ method: 'GET', path: `/rooms/${roomId}/members`, schema: rosterResponseSchema });
// createRoom, activateRoom, completeRoom, cancelRoom, listPrizes, createPrize,
// listRewards, fulfillAward, revokeAward, excludeMember — по той же форме со схемами SDK.
```

- [ ] **Step 4: Run green**, lint/typecheck

- [ ] **Step 5: Commit** — `feat(web): typed API-клиент с zod-валидацией и refresh-retry`

### Task 8: Realtime-клиент (`src/realtime/`)

**Files:**
- Create: `apps/web/src/realtime/socket-like.ts`, `apps/web/src/realtime/room-connection.ts`
- Test: `apps/web/src/realtime/room-connection.spec.ts` (+ `FakeSocket` в спеке)

**Interfaces:**
- Consumes: `ApiError` (Task 7), SDK realtime-схемы (`REALTIME_MESSAGES`, `subscribeOkAckSchema`, `publishOkAckSchema`, `projectedEventSchema`, `contractErrorPayloadSchema`).
- Produces: `SocketLike { onConnect(cb); onDisconnect(cb); onEvent(cb); emitWithAck(event, payload): Promise<unknown>; disconnect() }`; `createSocket(getAccessToken)` — единственный файл с `socket.io-client`; `RoomConnection(socket, roomId)`: `join(): Promise<RoomSnapshot>`, `onEvent(cb: (e: ProjectedEvent) => void)`, `onResync(cb: (s: RoomSnapshot) => void)`, `onStateChange(cb: (s: ConnectionState) => void)`, `publish(type: string, payload: Record<string, unknown>): Promise<void>`, `close()`; `ConnectionState = 'connecting' | 'live' | 'disconnected'`.

- [ ] **Step 1: Failing tests** (FakeSocket: программируемые ack, триггеры connect/disconnect/event):

```ts
it('join returns parsed snapshot on ok-ack')
it('join throws ApiError with server code on error-ack { code }')
it('onEvent parses ProjectedEvent; invalid payload → ZodError (fail-loud)')
it('reconnect after join → re-subscribe → onResync with fresh snapshot')
it('disconnect → onStateChange("disconnected"); connect → "live"')
it('publish ok-ack resolves; error-ack → ApiError')
```

- [ ] **Step 2: Run red**

- [ ] **Step 3: Implement**

```ts
// socket-like.ts — единственный импортёр socket.io-client (boundary web-socketio-only-in-realtime)
import { io, type Socket } from 'socket.io-client';
import { REALTIME_MESSAGES } from '@mymozhem/sdk';

export interface SocketLike { /* ...как в Interfaces... */ }

export const createSocket = (getAccessToken: () => string | null): SocketLike => {
  const socket: Socket = io({
    // same-origin (дизайн §0.3); токен читается на каждый handshake — reconnect со свежим.
    auth: (cb) => cb({ token: getAccessToken() }),
  });
  return {
    onConnect: (cb) => socket.on('connect', cb),
    onDisconnect: (cb) => socket.on('disconnect', cb),
    onEvent: (cb) => socket.on(REALTIME_MESSAGES.EVENT, cb),
    emitWithAck: (event, payload) => socket.emitWithAck(event, payload),
    disconnect: () => socket.disconnect(),
  };
};
```

```ts
// room-connection.ts
export class RoomConnection {
  private joined = false;
  private resyncCb: ((s: RoomSnapshot) => void) | null = null;
  private stateCb: ((s: ConnectionState) => void) | null = null;

  constructor(
    private readonly socket: SocketLike,
    private readonly roomId: string,
  ) {
    // Reconnect → re-subscribe → свежий snapshot в onResync (полный перефолд, дизайн §3).
    // Первый connect приходит до join() → joined=false → no-op.
    this.socket.onConnect(() => {
      this.stateCb?.(this.joined ? 'live' : 'connecting');
      if (this.joined) {
        void this.subscribeOnce().then((s) => this.resyncCb?.(s));
      }
    });
    this.socket.onDisconnect(() => this.stateCb?.('disconnected'));
  }

  onEvent(cb: (e: ProjectedEvent) => void): void {
    this.socket.onEvent((payload) => cb(projectedEventSchema.parse(payload)));
  }
  onResync(cb: (s: RoomSnapshot) => void): void { this.resyncCb = cb; }
  onStateChange(cb: (s: ConnectionState) => void): void { this.stateCb = cb; }

  async join(): Promise<RoomSnapshot> {
    const snapshot = await this.subscribeOnce();
    this.joined = true;
    this.stateCb?.('live');
    return snapshot;
  }

  async publish(type: string, payload: Record<string, unknown>): Promise<void> {
    const ack: unknown = await this.socket.emitWithAck(
      REALTIME_MESSAGES.PUBLISH,
      publishRequestSchema.parse({ type: type as PublishRequest['type'], payload }),
    );
    if (publishOkAckSchema.safeParse(ack).success) return;
    throw new ApiError(contractErrorPayloadSchema.parse(ack).code, 0);
  }

  close(): void { this.socket.disconnect(); }

  private async subscribeOnce(): Promise<RoomSnapshot> {
    const ack: unknown = await this.socket.emitWithAck(
      REALTIME_MESSAGES.SUBSCRIBE,
      subscribeRequestSchema.parse({ roomId: this.roomId }),
    );
    const ok = subscribeOkAckSchema.safeParse(ack);
    if (ok.success) return ok.data.snapshot;
    throw new ApiError(contractErrorPayloadSchema.parse(ack).code, 0);
  }
}
```

- [ ] **Step 4: Run green**, lint/typecheck

- [ ] **Step 5: Commit** — `feat(web): realtime-клиент RoomConnection (subscribe/resync/publish, ack-валидация)`

### Task 9: LogStore + проекции + golden-фикстура

**Files:**
- Create: `apps/web/src/state/log-store.ts`, `apps/web/src/state/projections.ts`, `apps/web/src/state/roster-refetch.ts`, `apps/web/src/state/fixtures/quiz-log.fixture.ts`
- Test: `apps/web/src/state/log-store.spec.ts`, `apps/web/src/state/projections.spec.ts`, `apps/web/src/state/roster-refetch.spec.ts`

**Interfaces:**
- Consumes: `ProjectedEvent`, `AppLogEvent`, `coreEventType`, `RoomStatus` (SDK); `initialQuizState/reduceQuiz/QuizState`; `initialLotteryState/reduceLottery/LotteryState`.
- Produces: `LogStore { pushLive(e); applySnapshot(events); reset(); all(): ProjectedEvent[] }`; `toAppLogEvent(e, appId, localSeq, recordedAt)`; `projectQuiz(events, recordedAt): QuizState`; `projectLottery(events, recordedAt): LotteryState`; `deriveRoomStatus(events): RoomStatus`; `shouldRefetchRoster(type: string): boolean`.

- [ ] **Step 1: Failing tests log-store** (вкл. Review Focus 3 — дуп из окна handshake применён дважды и это запинано):

```ts
it('buffers live events until snapshot; all() = snapshot + buffered + live')
it('duplicate from the handshake window is applied twice (accepted, design §3)')
it('reset() clears everything (re-subscribe path)')
```

- [ ] **Step 2: Implement LogStore**

```ts
import type { ProjectedEvent } from '@mymozhem/sdk';

// Фолд-модель клиента (дизайн §3): live до snapshot — в буфер; после snapshot —
// напрямую. Дуп из окна handshake (событие и в snapshot, и в буфере) структурно
// неотличим (wire без id/seq, REQ-RT-011a) — принят; лечится re-subscribe → reset +
// полный перефолд. Потеря события исключена.
export class LogStore {
  private snapshot: ProjectedEvent[] | null = null;
  private buffered: ProjectedEvent[] = [];
  private live: ProjectedEvent[] = [];

  pushLive(event: ProjectedEvent): void {
    (this.snapshot === null ? this.buffered : this.live).push(event);
  }
  applySnapshot(events: ProjectedEvent[]): void {
    this.snapshot = [...events];
  }
  reset(): void {
    this.snapshot = null;
    this.buffered = [];
    this.live = [];
  }
  all(): ProjectedEvent[] {
    return this.snapshot === null ? [] : [...this.snapshot, ...this.buffered, ...this.live];
  }
}
```

- [ ] **Step 3: Failing tests projections + roster-refetch, затем implement**

```ts
// projections.ts
import { coreEventType, type AppLogEvent, type ProjectedEvent, type RoomStatus } from '@mymozhem/sdk';
import { initialQuizState, reduceQuiz, type QuizState } from '@mymozhem/app-quiz';
import { initialLotteryState, reduceLottery, type LotteryState } from '@mymozhem/app-lottery';

// Адаптер wire → AppLogEvent (дизайн §3): wire несёт '<appId>.<short>' без seq/recordedAt
// (REQ-RT-011a). Локальный seq сохраняет порядок приёма; recordedAt — момент приёма
// (только отображение; баллы едут в payload question.revealed, не из тайминга).
export const toAppLogEvent = (
  event: ProjectedEvent, appId: string, localSeq: number, recordedAt: string,
): AppLogEvent => ({
  shortName: event.type.slice(appId.length + 1),
  payload: event.payload,
  actorId: event.actorId,
  seq: localSeq,
  recordedAt,
});

const foldApp = <S>(
  appId: string,
  events: ProjectedEvent[],
  initial: () => S,
  reduce: (state: S, event: AppLogEvent) => S,
  recordedAt: string,
): S =>
  events
    .filter((e) => e.type.startsWith(`${appId}.`))
    .reduce((state, e, i) => reduce(state, toAppLogEvent(e, appId, i + 1, recordedAt)), initial());

export const projectQuiz = (events: ProjectedEvent[], recordedAt: string): QuizState =>
  foldApp('quiz', events, initialQuizState, reduceQuiz, recordedAt);
export const projectLottery = (events: ProjectedEvent[], recordedAt: string): LotteryState =>
  foldApp('lottery', events, initialLotteryState, reduceLottery, recordedAt);

// Статус комнаты — из lifecycle-событий лога (REQ-RT-010); последнее побеждает.
export const deriveRoomStatus = (events: ProjectedEvent[]): RoomStatus => {
  let status: RoomStatus = 'DRAFT';
  for (const e of events) {
    if (e.type === coreEventType('room.activated')) status = 'ACTIVE';
    else if (e.type === coreEventType('room.completed')) status = 'COMPLETED';
    else if (e.type === coreEventType('room.cancelled')) status = 'CANCELLED';
  }
  return status;
};
```

```ts
// roster-refetch.ts — join не эмитит событий: ростер рефетчим на subscribe и на
// событиях, где имена показываются (Review Focus 2).
const ROSTER_REFETCH_EVENTS = new Set(['quiz.question.revealed', 'quiz.game.finished', 'lottery.draw.completed']);
export const shouldRefetchRoster = (type: string): boolean => ROSTER_REFETCH_EVENTS.has(type);
```

golden-фикстура (`fixtures/quiz-log.fixture.ts`): рукописный массив `ProjectedEvent[]` мини-игры (2 вопроса, 2 игрока: open→submit→close→reveal ×2 → finish) и спек `projections.spec.ts`:

```ts
it('golden: фолд записанного лога ≡ ожидаемая проекция (порядок/адаптер, не редьюсер)')
// assert: currentQuestion, accepting, totals по actorId, finished; recordedAt фиксированной строкой
it('фильтр по appId: события lottery/core не попадают в quiz-проекцию')
it('deriveRoomStatus: пусто → DRAFT; activated → ACTIVE; completed позже → COMPLETED')
```

- [ ] **Step 4: Run green**, lint/typecheck

- [ ] **Step 5: Commit** — `feat(web): LogStore (buffer/перефолд) + проекции через редьюсеры app-пакетов + golden-фикстура`

---

## Батч C — сессия, участник, экран

### Task 10: SessionStore + useRoomBinding

**Files:**
- Create: `apps/web/src/state/session.ts`, `apps/web/src/state/use-room-binding.ts`
- Test: `apps/web/src/state/session.spec.ts`

**Interfaces:**
- Consumes: `TokenProvider`, endpoints `refreshSession` (Task 7), `RoomConnection`+`createSocket` (Task 8), `LogStore` (Task 9).
- Produces: `decodeAccessClaims(token): { sub: string; kind: 'GUEST'|'REGISTERED'; roomId?: string }`; `SessionStore implements TokenProvider` (+ static `loadGuest/saveGuest/clearGuest` `{code, displayName}`, `loadHostRoomId/saveHostRoomId`); `useRoomBinding(roomId: string | null, tokens: TokenProvider): { connectionState: ConnectionState; events: ProjectedEvent[]; appSettings: Record<string, unknown>; publish(type, payload): Promise<void> }`.

- [ ] **Step 1: Failing tests session** (вкл. Review Focus 1 — декод display-only, комментарий в коде):

```ts
it('decodes claims payload (base64url) — sub/kind/roomId')
it('throws on malformed token')
it('guest session localStorage roundtrip; clearGuest removes')
it('refresh() replaces accessToken (через инжектированный refreshFn)')
```

- [ ] **Step 2: Implement session.ts**

```ts
import type { TokenProvider } from '../api/token-provider';

// JWT-декод БЕЗ верификации — только для UI («кто я», моя комната). Все решения
// доступа — на сервере; подделанный payload прав не даёт (Review Focus 1).
export const decodeAccessClaims = (token: string): { sub: string; kind: 'GUEST' | 'REGISTERED'; roomId?: string } => {
  const part = token.split('.')[1];
  if (!part) throw new Error('malformed access token');
  return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { sub: string; kind: 'GUEST' | 'REGISTERED'; roomId?: string };
};

const GUEST_KEY = 'mm.guest.session';
const HOST_ROOM_KEY = 'mm.host.roomId';

export interface GuestSession { code: string; displayName: string; }

// Access-токен — в памяти (TTL ≤ 15 мин, refresh по 401); localStorage — только
// переживающая перезагрузку идентификация (код/имя гостя, roomId организатора).
export class SessionStore implements TokenProvider {
  private accessToken: string | null = null;
  constructor(private readonly refreshFn: () => Promise<string>) {}
  getAccessToken(): string | null { return this.accessToken; }
  setAccessToken(token: string): void { this.accessToken = token; }
  async refresh(): Promise<void> { this.accessToken = await this.refreshFn(); }

  static loadGuest(): GuestSession | null {
    try {
      const raw = localStorage.getItem(GUEST_KEY);
      return raw ? (JSON.parse(raw) as GuestSession) : null;
    } catch { return null; }
  }
  static saveGuest(s: GuestSession): void { localStorage.setItem(GUEST_KEY, JSON.stringify(s)); }
  static clearGuest(): void { localStorage.removeItem(GUEST_KEY); }
  static loadHostRoomId(): string | null { return localStorage.getItem(HOST_ROOM_KEY); }
  static saveHostRoomId(id: string): void { localStorage.setItem(HOST_ROOM_KEY, id); }
}
```

- [ ] **Step 3: Implement use-room-binding.ts** (тонкий React-клей; логика — в LogStore, тестирована):

```ts
export function useRoomBinding(roomId: string | null, tokens: TokenProvider): {
  connectionState: ConnectionState;
  events: ProjectedEvent[];
  appSettings: Record<string, unknown>;
  publish: (type: string, payload: Record<string, unknown>) => Promise<void>;
} {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [events, setEvents] = useState<ProjectedEvent[]>([]);
  const [appSettings, setAppSettings] = useState<Record<string, unknown>>({});
  const connRef = useRef<RoomConnection | null>(null);

  useEffect(() => {
    if (!roomId) return;
    const store = new LogStore();
    const conn = new RoomConnection(createSocket(() => tokens.getAccessToken()), roomId);
    connRef.current = conn;
    conn.onEvent((e) => { store.pushLive(e); setEvents(store.all()); });
    conn.onResync((snapshot) => {
      store.reset();
      store.applySnapshot(snapshot.events);
      setAppSettings(snapshot.appSettings);
      setEvents(store.all());
    });
    conn.onStateChange(setConnectionState);
    void conn.join().then((snapshot) => {
      store.applySnapshot(snapshot.events);
      setAppSettings(snapshot.appSettings);
      setEvents(store.all());
    });
    return () => conn.close();
  }, [roomId, tokens]);

  return {
    connectionState,
    events,
    appSettings,
    publish: (type, payload) => {
      const conn = connRef.current;
      if (!conn) return Promise.reject(new ApiError('NOT_CONNECTED', 0));
      return conn.publish(type, payload);
    },
  };
}
```

- [ ] **Step 4: Run green** (unit session), typecheck

- [ ] **Step 5: Commit** — `feat(web): SessionStore + useRoomBinding (snapshot/resync фолд в React)`

### Task 11: /play — участник + shared-компоненты

**Files:**
- Create: `apps/web/src/pages/play/join-form.tsx`, `apps/web/src/pages/play/play-page.tsx`
- Create: `apps/web/src/components/standings.tsx`, `apps/web/src/components/winners.tsx`, `apps/web/src/components/connection-banner.tsx`, `apps/web/src/components/roster-names.ts`
- Modify: `apps/web/src/App.tsx` (маршруты)
- Test: `apps/web/src/components/roster-names.spec.ts`

**Interfaces:**
- Consumes: Tasks 7–10; `quizSettingsSchema`-форма settings (`questions: {text, options[]}[]`), `QuizState`.
- Produces (для Task 12 и консоли): `<Standings totals|standings names />`, `<Winners awards names />`, `<ConnectionBanner state />`, `rosterNames(members): Map<identityId, string>` (null-имя → «Гость» fallback).

- [ ] **Step 1: Failing test roster-names** (`null → 'Гость'`, обычный маппинг)

- [ ] **Step 2: Implement components** (functional-minimum, дизайн §0.4):

roster-names.ts:
```ts
import type { RosterEntry } from '@mymozhem/sdk';

// null — swept-гость (анонимизация); fallback-имя, а не пустая строка в табло.
export const rosterNames = (members: RosterEntry[]): Map<string, string> =>
  new Map(members.map((m) => [m.identityId, m.displayName ?? 'Гость']));
```

standings.tsx — таблица имя+очки из `QuizState['totals']` (сортировка desc, плотный ранг не нужен — отображение); winners.tsx — список из `lottery`-проекции (`draws: {prizeId, winnerId}[]` + roster-имена); connection-banner.tsx — «Нет соединения…» при `state !== 'live'`.

- [ ] **Step 3: Implement join-form + play-page**

join-form.tsx: поля код (из `:code` параметра, если есть — read-only отображение) + displayName → `joinRoom(client, { code, displayName })` → `session.setAccessToken(res.accessToken)`, `SessionStore.saveGuest`, `onJoined(roomId из decodeAccessClaims)`.

play-page.tsx (каркас):

```tsx
export function PlayPage(): JSX.Element {
  const { code } = useParams();
  const saved = SessionStore.loadGuest();
  const [session] = useState(() => new SessionStore(async () => (await refreshSession(anonClient)).accessToken));
  const [roomId, setRoomId] = useState<string | null>(null);
  // guest join: session.setAccessToken → claims.roomId → setRoomId; при протухшей сессии —
  // повторный join по saved (дизайн §5: новая identity, «вы вошли заново»).
  const binding = useRoomBinding(roomId, session);
  const quiz = projectQuiz(binding.events, /* receivedAt */ new Date().toISOString());
  const status = deriveRoomStatus(binding.events);
  const myId = /* decodeAccessClaims(session.getAccessToken()).sub */;
  // roster: listMembers на subscribe + shouldRefetchRoster по событиям (Task 9)
  // views: status !== 'ACTIVE' → Lobby; quiz.accepting → QuestionView; reveal → Result;
  // quiz.finished → Finished (+Winners). QuestionView: options из appSettings.questions
  // [quiz.currentQuestion], publish 'quiz.answer.submitted' { questionIndex, optionIndex };
  // ack ok → «Ответ принят»; ApiError → текст кода.
}
```

(Компонент пишется целиком исполнителем по этому каркасу; все ветки из дизайна §4 — лобби/вопрос/reveal/финал + ConnectionBanner.)

- [ ] **Step 4: Run** — unit зелёный, typecheck, `pnpm --filter @mymozhem/web build`

- [ ] **Step 5: Commit** — `feat(web): страница участника /play + shared-компоненты (standings/winners/banner)`

### Task 12: /screen — проектор

**Files:**
- Create: `apps/web/src/pages/screen/screen-page.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: Tasks 7–11. Отличие от play: join с `role: 'spectator'`, read-only.

- [ ] **Step 1: Implement** — join по коду из `:code` (displayName фиксированный `'Экран'`; joinRequestSchema принимает role `'spectator'`) → тот же useRoomBinding → views: текущий вопрос крупно (`appSettings.questions[currentQuestion].text` + options), после reveal — `<Standings>`, финал — `<Standings>` + `<Winners>`. Без форм и кнопок.

- [ ] **Step 2: Run** — typecheck/build зелёные

- [ ] **Step 3: Commit** — `feat(web): проекторный экран /screen (spectator-join, read-only)`

---

## Батч D — организатор

### Task 13: Лендинг, OAuth-гейт, создание комнаты, setup (редактор квиза / настройки лотереи)

**Files:**
- Create: `apps/web/src/pages/landing.tsx`, `apps/web/src/pages/host/host-gate.tsx`, `apps/web/src/pages/host/setup-page.tsx`, `apps/web/src/pages/host/quiz-editor.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/pages/host/quiz-editor.spec.ts` (сборка settings из формы)

**Interfaces:**
- Consumes: Tasks 7, 10; `QUIZ_APP_ID`, `QUIZ_MANIFEST_VERSION`, `quizSettingsSchema` (`@mymozhem/app-quiz`); `LOTTERY_APP_ID` (`@mymozhem/app-lottery`); `configureRoom`, `activateRoom` (Task 7).
- Produces: `buildQuizSettings(form: QuizFormState): unknown` — чистая функция формы → settings (тестируема без DOM); потребитель Task 14 — `SessionStore.loadHostRoomId`.

- [ ] **Step 1: Failing test buildQuizSettings**

```ts
it('maps form rows to quiz settings (correctAnswers из отмеченных радио)')
it('reject пустого текста/варианта (quizSettingsSchema.safeParse fail)')
```

- [ ] **Step 2: Implement**

landing.tsx: две кнопки — «Я организатор» → `<a href={'/auth/google?redirect=' + encodeURIComponent('/host')}>`; «У меня есть код» → ввод → navigate `/play/${code}`.

host-gate.tsx: `useEffect` → `refreshSession` (cookie same-origin; `auth:false`) → ok: `setAccessToken`, claims.kind === 'REGISTERED' иначе navigate('/') → `SessionStore.loadHostRoomId()` → есть: navigate('/host/console'); нет: navigate('/host/new'). Ошибка refresh → navigate('/').

setup-page.tsx: если roomId нет — `createRoom(client, { joinPolicy: 'guests' })` → `saveHostRoomId`; выбор приложения (quiz|lottery); quiz → `<QuizEditor onSubmit>`; lottery → радио `drawEligibility` (guests_allowed|verified, дефолт guests_allowed) → settings `{}` или `{ drawEligibility }`; submit → `configureRoom` → `activateRoom` → navigate('/host/console').

quiz-editor.tsx: форма (вопросы: текст, 2–6 вариантов, радио «правильный»; scoring base/step; minAnswerIntervalMs) → `buildQuizSettings` → `quizSettingsSchema.parse` на клиенте (та же схема, что серверная — дрейф невозможен структурно) → onSubmit(settings).

- [ ] **Step 3: Run green** (unit editor), typecheck/build

- [ ] **Step 4: Commit** — `feat(web): лендинг, OAuth-гейт организатора, setup комнаты (редактор квиза / лотерея)`

### Task 14: Консоль — ведение квиза

**Files:**
- Create: `apps/web/src/pages/host/console-page.tsx`, `apps/web/src/pages/host/quiz-controls.tsx`
- Test: `apps/web/src/pages/host/quiz-controls.spec.ts` (селектор next-question/answers-count)

**Interfaces:**
- Consumes: Tasks 7–11, 13. `projectQuiz`, `deriveRoomStatus`, publish-команды `quiz.question.opened/closed`, `quiz.game.finish` (clientInitiated; reveal/finished коммитит модуль — кнопок reveal нет).
- Produces: `answersCount(events, questionIndex): number` (distinct actorId среди `quiz.answer.accepted` текущего вопроса).

- [ ] **Step 1: Failing test answersCount / nextQuestionIndex**

- [ ] **Step 2: Implement** — console-page: код комнаты крупно + копируемые ссылки `/play/<code>` и `/screen/<code>` (navigator.clipboard); ConnectionBanner; quiz-controls по проекции: «Открыть вопрос N» (`N = quiz.currentQuestion === null ? 0 : quiz.currentQuestion + 1`; disabled, пока `accepting`); «Закрыть вопрос» (пока accepting); счётчик ответов `answersCount`; после reveal — `<Standings>`; «Завершить квиз» → publish `quiz.game.finish` → `<Standings>` финальный. Ошибки publish → текст кода (`ApiError.code`).

- [ ] **Step 3: Run green**, typecheck/build

- [ ] **Step 4: Commit** — `feat(web): консоль ведущего — ведение квиза (open/close/finish, счётчик, табло)`

### Task 15: Консоль — участники (exclude), призы, розыгрыш, вручение, завершение

**Files:**
- Create: `apps/web/src/pages/host/members-panel.tsx`, `apps/web/src/pages/host/prizes-panel.tsx`, `apps/web/src/pages/host/awards-panel.tsx`
- Modify: `apps/web/src/pages/host/console-page.tsx`
- Test: `apps/web/src/pages/host/prizes-panel.spec.ts` (селектор «приз доступен для розыгрыша»: quantity > 0)

**Interfaces:**
- Consumes: `listMembers/excludeMember/listPrizes/createPrize/listRewards/fulfillAward/revokeAward/completeRoom` (Task 7); publish `lottery.draw.run` `{ drawId: crypto.randomUUID(), prizeId }` (только в lottery-комнате — панель рисуется по пину из `core.room.activated` payload `appId`).

- [ ] **Step 1: Failing test** — селектор доступных для розыгрыша призов (`quantity > 0`); повторный клик draw до ack — disabled (drawId один на попытку — идемпотентность, дизайн ф.3 §4)

- [ ] **Step 2: Implement** — members-panel: ростер (role participant/spectator) + «Исключить» → `excludeMember` → рефетч; prizes-panel: форма name+quantity → `createPrize` → рефетч `listPrizes`; в lottery-комнате — кнопка «Разыграть» у приза с quantity>0 → publish draw.run → результат виден в `<Winners>` (draw.completed из live); awards-panel: `listRewards` + roster-имена + кнопки fulfill/revoke (disabled не в AWARDED) → рефетч; «Завершить событие» → `completeRoom` (confirm()) → статус COMPLETED.

- [ ] **Step 3: Run green**, typecheck/build

- [ ] **Step 4: Commit** — `feat(web): консоль — участники/призы/розыгрыш/вручение/завершение`

---

## Батч E — e2e и приёмка

### Task 16: Playwright smoke + CI

**Files:**
- Create: `apps/web/e2e/playwright.config.ts`, `apps/web/e2e/smoke.spec.ts`, `apps/server/scripts/e2e-web-seed.mjs`
- Modify: `apps/web/package.json` (`test:e2e`), `.github/workflows/ci.yml` (job e2e-web)

**Interfaces:**
- Consumes: запущенный docker-compose стенд (`WEB_STATIC_DIR` из Task 6); seed-скрипт по патерну `apps/server/scripts/create-room.mjs` (subpath-импорты dist, не barrel) — создаёт REGISTERED identity + сессию через `TokenService`, печатает JSON `{ refreshToken }`; cookie — `mm_refresh` (`REFRESH_COOKIE`).

- [ ] **Step 1: Seed-скрипт** — зеркало create-room.mjs + TokenService; usage: `node apps/server/scripts/e2e-web-seed.mjs --email=e2e@example.com` → stdout JSON.

- [ ] **Step 2: Smoke-сьют** (baseURL `http://localhost:3000`, workers 1, retries 1):

```ts
// 1) Организатор: context.addCookies mm_refresh (seed) → /host → create room →
//    редактор (1 вопрос, 2 варианта) → configure+activate → консоль, код комнаты виден.
// 2) Участник: новый context → /play/<code> → join → лобби; организатор open →
//    у участника варианты → ответ → «Ответ принят»; организатор close → участник: reveal/табло.
// 3) Экран: context → /screen/<code> → вопрос виден крупно после open.
// Один сьют, последовательные шаги тремя context'ами в одном test (shared room code).
```

- [ ] **Step 3: CI job e2e-web** — после build: `docker compose up -d --build` (JWT_SECRET из secrets/фиктивный тестовый), wait `/health/live`, `pnpm exec playwright install --with-deps chromium`, seed → `pnpm --filter @mymozhem/web test:e2e`, `docker compose down` (always). **Только локальный compose-стенд — никогда не против production.**

- [ ] **Step 4: Локальный зелёный прогон** — compose up, seed, `pnpm --filter @mymozhem/web test:e2e` зелёный; полный конвейер зелёный.

- [ ] **Step 5: Commit** — `test(web): Playwright smoke (host/play/screen) против compose-стенда + CI job`

### Task 17: Smoke-чеклист первого события + exit-аудит среза

**Files:**
- Create: `docs/sessions/2026-09-23-ui-slice-smoke-checklist.md`
- Create: `docs/sessions/2026-09-23-ui-slice-exit-audit.md`
- Modify: `HANDOFF.md` (навык handoff)

- [ ] **Step 1: Чеклист** — ручной прогон перед событием: OAuth с реальными Google-кредами (действие владельца — шаги), create→editor→configure→activate, два телефона-участника, экран, обрыв Wi-Fi у участника (перефолд), приз+розыгрыш+fulfill/revoke, завершение; каждая строка — наблюдаемый результат.
- [ ] **Step 2: Exit-аудит** — сверка критериев §8 дизайна (1–7) с артефактами файл:строка; протокол конвейера; открытые вопросы владельцу, если вскрылись.
- [ ] **Step 3: HANDOFF** — навык handoff; мердж/push — решение владельца.
- [ ] **Step 4: Commit** — `docs(sessions): smoke-чеклист + exit-аудит UI-среза`

---

## Self-review

**1. Spec coverage:** §0 решения — 1: объём (Tasks 11–15) ✓; 2: гости-only (Task 11, JoinController не тронут) ✓; 3: same-origin (Task 6) ✓; 4: функц. минимум (все страницы) ✓; 5: форма редактора (Task 13) ✓; 6: экран (Task 12) ✓; 7: подход A временный (Tasks 7–10 слои без React вне хуков) ✓; 8: Playwright (Task 16) ✓; 9: lifecycle-контур (Task 5) ✓; 10: ростер (Tasks 4–5) ✓. Pre-tasks P1/P2 — Tasks 1–2 ✓. §8 критерии — Task 17 сверка ✓. `GET /rooms/:id/prizes` — Task 5 ✓.

**2. Placeholder scan:** каркас play-page в Task 11 — намеренно скелет с явным перечнем веток (React-разметка по дизайну §4, не «TBD»); остальные кодовые блоки полные.

**3. Type consistency:** `ApiClient.call`, `TokenProvider`, `SocketLike`, `RoomConnection`, `LogStore`, `projectQuiz/projectLottery/deriveRoomStatus/shouldRefetchRoster`, `SessionStore`, `rosterNames`, `buildQuizSettings`, `answersCount` — имена/сигнатуры согласованы между задачами (Interfaces-блоки).

**4. Review Focus:** все 5 строк имеют тесты в названных задачах (1→Task 10, 2→Task 9, 3→Task 9, 4→Task 7, 5→Task 6).

**Известные интерпретации (зафиксированы для ревью владельцем):**
- **I-1:** `recordedAt` клиентской проекции — момент приёма события (wire его не несёт); влияет только на отображение, не на баллы.
- **I-2:** повторный join гостя после протухшей сессии создаёт новую identity (очки не переносятся) — принято в дизайне §5.
- **I-3:** ростер рефетчится событийно (reveal/finish/draw.completed) + на subscribe; join не виден мгновенно — Review Focus 2.
- **I-4:** organizer-флоу Playwright обходит Google OAuth seed-скриптом (выдача refresh вне Google) — OAuth smoke остаётся ручным действием владельца (Task 17 чеклист).
- **I-5:** console рисует lottery-панель по пину комнаты (одна комната = одно приложение, ф.3).
