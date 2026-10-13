# Task 6 report — REST-контур rewards (контроллер + wire-маппинг)

**Commit:** `d14d27d` — `feat(core): REST-контур rewards — prizes/rewards/fulfill/revoke, wire-маппинг кодов фазы 3`
**Статус:** DONE, все лайны зелёные.

## Что сделано

1. **`packages/core/package.json` + `pnpm-lock.yaml`** — `@nestjs/platform-fastify@^11.0.0` в devDependencies core (рулинг 3), `pnpm install` из корня, один lockfile.
2. **`packages/core/src/rewards/rewards.controller.ts`** (новый) — 4 эндпоинта по брифу verbatim: `POST /rooms/:roomId/prizes` (201), `GET /rooms/:roomId/rewards`, `POST .../awards/:awardId/fulfill|revoke` (`@HttpCode(200)`). `authenticate(req, tokens)` синхронный — вызывается без `await`. `RequestLike` импортирован из `../transport/http.types` (не из `authenticate.ts`); body у RequestLike не типизирован — `(req as { body?: unknown }).body` по рулингу. Ответная `.parse` на границе через SDK-схемы (Date→ISO мапперами `toPrizeResponse`/`toAwardResponse`).
3. **`packages/core/src/rewards/rewards.module.ts`** — `imports += AuthModule` (TokenService экспортирует, прецедент подтверждён), `controllers: [RewardsController]`.
4. **`packages/core/src/transport/http-exception.filter.ts`** — 5 новых статусов в `STATUS_BY_WIRE_CODE` перед `INTERNAL_ERROR` (ROOM_NOT_ACTIVE 409, PRIZE_UNKNOWN 404, AWARD_UNKNOWN 404, PRIZE_FUND_EXHAUSTED 409, REWARD_ALREADY_RESOLVED 409) и ОБЕ ветки в `toWireCode` после `RoomError`, до `ZodError` (рулинг 1): `ContractError` + симметричная `RealtimeError` (`RoomNotActiveError` — core-internal, не ContractError). Прочие realtime-коды в маппинге нет → INTERNAL_ERROR.
5. **`http-exception.filter.spec.ts`** — 6 новых кейсов в таблице: 4 ContractError-кода + ROOM_NOT_ACTIVE (через настоящий `RoomNotActiveError`) + пин- кейс `EventTypeUnknownError → 500 INTERNAL_ERROR` (blast radius ровно ROOM_NOT_ACTIVE).
6. **`rewards.controller.int-spec.ts`** (новый) — HTTP-путь через fastify inject + testcontainers: 201/400/403 на prizes, полный цикл fulfill (200 + no-op 200) → cross-revoke 409 → чужая награда 404 → list 200, без токена 401.

## RED/GREEN evidence

- RED unit: 5 failed / 27 passed (маппинг отдавал 500); RED int: 3 failed / 0 passed (404 неизвестного роута).
- GREEN: `http-exception` 32/32; `rewards.controller` 3/3.
- Полные лайны core: `build` чисто, `test` 18 suites / 222 passed, `test:int` 19 suites / 177 passed, `lint` чисто, `pnpm boundary-check` — no dependency violations (568 modules).

## Отклонения от брифа (все — по рулингам контроллера или вынужденные)

- Рулинг 1: обе ветки фильтра + `import { RealtimeError } from '../realtime/realtime.errors'`.
- Рулинг 2: `roomService.activate(...)` убран из int-спека — комната DRAFT.
- Рулинг 3: platform-fastify добавлен, lockfile в коммите.
- Рулинг 4: `displayName` убран из всех `seedIdentity`-вызовов; гости сидятся без email вообще (`email` опционален, default null — уникальность тривиальна).
- **Добавлен `AppRuntimeModule.register([])` в imports int-спека** (в брифе отсутствовал): RealtimeGateway — провайдер RealtimeModule, разрешает AppRuntimeService через global-провайдер; без register DI не собирается (та же оговорка в rewards.int-spec.ts Task 5).
- `afterEach` TRUNCATE расширен `realtime."LogEvent"` — fulfill/revoke пишут события в лог, без транкейта строки копились бы между тестами.
- Award сидится напрямую одним `db.prisma.award.create` (результат используется напрямую, без последующего `findFirstOrThrow`).
- Опциональное усиление принято: после fulfill по HTTP — прямая проверка строки `rewards.reward.fulfilled` в `realtime."LogEvent"` через `db.prisma.logEvent.findFirst` (замечание ревью Task 5 о косвенности лог-ассертов). Стоило одну строку.
- `packages/core/src/index.ts` НЕ тронут: контроллеры в barrel не экспортируются (прецедент ExcludeController/RoomsController — только module/filter/tokens).

## Concerns

- Гостевой scope-гард (`claims.kind === 'GUEST' && claims.roomId !== roomId`, прецедент ExcludeController) в контроллер не добавлен — бриф verbatim, а `assertOrganizer` в домене покрывает чужую комнату через membership/роль. Если ревью сочтёт REQ-ID-016 обязывающим и для REST-контура rewards — это +3 строки в каждый хендлер или один общий хелпер; не блокер.
- E2E-приёмка эндпоинтов — Task 12 (за пределами этого среза).
