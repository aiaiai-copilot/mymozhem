# Task 5 report — Транспорт: rooms-lifecycle, members, prizes-list

## What I implemented

- **`packages/core/src/transport/rooms-lifecycle.controller.ts`** (new) — `POST /rooms/:roomId/configure|activate|complete|cancel`, organizer-only. Порядок в каждом обработчике: `authenticate(req, tokens)` → `z.uuid().parse(roomId)` → `membership.assertOrganizer(id, claims.sub)` → zod-валидация тела (configure) → `RoomService` → ответная `createRoomResponseSchema.parse` на границе. Три перехода свёрнуты в приватный `transition`, как в скетче брифа.
- **`packages/core/src/transport/members.controller.ts`** (new) — `GET /rooms/:roomId/members` любому активному члену (`assertMember`), ростер через `listRoster`, роли uppercase→lowercase, ответная `rosterResponseSchema.parse`.
- **`packages/core/src/rewards/rewards.controller.ts`** — `+= GET :roomId/prizes`, зеркало `listRewards`; переиспользован существующий приватный `toPrizeResponse`.
- **`packages/core/src/rewards/rewards.service.ts`** — `+= listPrizes(roomId, actorId)`: `assertOrganizer` + `prize.findMany({ where: { roomId }, orderBy: { createdAt: 'asc' } })`, сигнатура сверена с `listAwards` (зеркало 1:1).
- **`packages/core/src/transport/transport.module.ts`** — controllers += `RoomsLifecycleController`, `MembersController` (все провайдеры — RoomModule/MembershipModule/AuthModule — уже в imports модуля).
- **`packages/core/src/transport/http-exception.filter.ts`** (+ spec) — расширение маппинга RoomError, см. «Divergences».

## What I tested and test results

- `rooms-lifecycle.controller.int-spec.ts` (new, 9 tests): все 6 кейсов брифа + `it.each` негативной границы `manifestVersion: 0 / 1.5` → 400 REQUEST_INVALID (добавка финревью батча 1). В activate-кейсе дополнительно проверен лог: `core.room.activated` с пином `{appId, manifestVersion}` и `actorId: ORG` из JWT.
- `members.controller.int-spec.ts` (new, 4 tests): все кейсы брифа, включая swept-гостя (строка identity обновлена зеркалом guest-sweep: `displayName: null, deletedAt: now`).
- `rewards.controller.int-spec.ts` — += кейс `GET /rooms/:id/prizes` (2 приза с quantity/quantityTotal; participant → 403).
- `http-exception.filter.spec.ts` — кейс `RoomTransitionError → 500 INTERNAL_ERROR` заменён на четыре типизированных (409 + wire-код 1:1).
- Полные прогоны: core unit **227/227**, core int **206/206** (22 сьюита), apps/server e2e **67/67** (7 сьюитов), boundary-check/lint/typecheck — зелёные.

## TDD Evidence

### RED

Команды (после `pnpm build`, до реализации):

```
pnpm --filter @mymozhem/core test:int rooms-lifecycle
pnpm --filter @mymozhem/core test:int members.controller
pnpm --filter @mymozhem/core test:int rewards.controller -t "GET /rooms/:id/prizes"
```

Релевантный вывод:

```
FAIL src/transport/rooms-lifecycle.controller.int-spec.ts
  error TS2307: Cannot find module './rooms-lifecycle.controller' or its corresponding type declarations.
FAIL src/transport/members.controller.int-spec.ts
  error TS2307: Cannot find module './members.controller' or its corresponding type declarations.

● RewardsController (int) › GET /rooms/:id/prizes: organizer видит список с quantity/quantityTotal; participant → 403
    Expected: 200
    Received: 404
```

Почему ожидаемо: контроллеров не существует (module resolution — красный новых спек), а `GET /rooms/:id/prizes` не зарегистрирован в существующем RewardsController — подлинный runtime-404 красный на существующем сьюите. Ожидаемые брифом «404» для lifecycle/members-кейсов подтверждены косвенно: rewards-кейс показывает, что незарегистрированный маршрут в этом тестовом модуле даёт ровно 404.

### GREEN

```
pnpm build && pnpm --filter @mymozhem/core test:int rooms-lifecycle
  Tests: 9 passed, 9 total
pnpm --filter @mymozhem/core test:int members.controller
  Tests: 4 passed, 4 total
pnpm --filter @mymozhem/core test:int rewards.controller
  Tests: 4 passed, 4 total
pnpm --filter @mymozhem/core test:int   → 22 suites, 206 passed
pnpm --filter @mymozhem/core test       → 18 suites, 227 passed
pnpm --filter @mymozhem/server test     → 7 suites, 67 passed (AppModule с новыми контроллерами собирается и работает)
pnpm boundary-check / lint / typecheck  → зелёные
```

## Files changed

- `packages/core/src/transport/rooms-lifecycle.controller.ts` (new)
- `packages/core/src/transport/members.controller.ts` (new)
- `packages/core/src/transport/rooms-lifecycle.controller.int-spec.ts` (new)
- `packages/core/src/transport/members.controller.int-spec.ts` (new)
- `packages/core/src/rewards/rewards.controller.ts` (+= GET `:roomId/prizes`)
- `packages/core/src/rewards/rewards.service.ts` (+= `listPrizes`)
- `packages/core/src/rewards/rewards.controller.int-spec.ts` (+= кейс)
- `packages/core/src/transport/transport.module.ts` (controllers += 2)
- `packages/core/src/transport/http-exception.filter.ts` (маппинг RoomError — divergence, см. ниже)
- `packages/core/src/transport/http-exception.filter.spec.ts` (кейсы маппинга)

## Self-review findings

1. **Filter extension (не в Files-листе брифа).** Бриф требует `повторный activate → ROOM_TRANSITION_INVALID` и `activate after complete → ROOM_TRANSITION_INVALID` по HTTP, но существующий фильтр сворачивал все RoomError, кроме ROOM_ORGANIZER_NOT_REGISTERED, в 500 INTERNAL_ERROR (с пинящим это unit-кейсом). Без расширения фильтра кейсы брифа невыполнимы. Замаплены все пять кодов RoomError 1:1 (строковый паритет прямо предусмотрен комментарием в `room.errors.ts`: «будущий транспорт отобразит code→code 1:1» — этот транспорт и есть тот будущий): ROOM_TRANSITION_INVALID/ROOM_CONFLICT/ROOM_NOT_CONFIGURED/ROOM_SETTINGS_FROZEN → 409, ветка fail-closed для неизвестного кода сохранена.
2. **@HttpCode(200) на всех четырёх POST-эндпоинтах** — в скетче брифа декоратора нет, но тест-кейсы брифа ожидают 200, а Nest по умолчанию отдаёт 201 на POST. Ресурс не создаётся; прецедент — `@HttpCode(200)` на fulfill/revoke в RewardsController.
3. В остальном чек-лист: organizer-gate перед каждой операцией ✓, ответная `.parse` на границе ✓, actorId только из JWT ✓, комментарии на русском «почему» ✓, глобального мутабельного состояния нет ✓, scope creep отсутствует ✓.

## Divergences from the brief's sketch

1. **`http-exception.filter.ts` + spec** — добавлены в объём (причина выше, пункт 1). Статус 409 для ROOM_CONFLICT — мой выбор (коллапсированный код «not found / deleted / гонка»; 409 = конфликт с текущим состоянием, консистентно с REWARD_ALREADY_RESOLVED/ROOM_NOT_ACTIVE).
2. **@HttpCode(200)** — добавлен против скетча (причина выше, пункт 2).
3. **Лотерейный манифест в lifecycle-спеке собран локально через `defineApp`** (zod-схема с defaulted `drawEligibility`, зеркало `packages/app-lottery/src/lottery-settings.ts`): прямой импорт `@mymozhem/app-lottery` ядру запрещён boundary-правилом, а SDK-фикстура `validManifests[1]` требует `fundLimit` и `{}` не пропустила бы. Сборка через `defineApp` — тем же путём, что реальное приложение, так что кейс «configure `{}` passes the gate» — честный end-to-end через P1 (`toRegisteredSchema` io:'input').
4. RED новых спек — module-resolution failure (TS2307), а не per-test 404: спеки сразу импортируют контроллер (одна версия файла между red и green). Runtime-404 красный показан на rewards-кейсе.

## Issues / concerns

- `ROOM_CONFLICT → 409` (а не 404) — осознанный выбор в духе коллапсированных кодов (не раскрывать «комнаты нет» отдельно от «гонка/удалена»); если владелец захочет 404 для stale-roomId в клиенте — точка одна, таблица STATUS_BY_WIRE_CODE.
