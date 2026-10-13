# Task 3 Report: SDK wire-схемы — configure-request, ростер, список призов

## Status: DONE

## What was implemented

Three new zod wire-schemas in `@mymozhem/sdk`, per brief verbatim (comments in Russian, why-style, as provided):

- `packages/sdk/src/room/configure-room-request.ts` — `configureRoomRequestSchema` (strictObject: `appId: appIdSchema`, `manifestVersion: int positive`, `settings: record(string, unknown)`) + `ConfigureRoomRequest` type. Для POST /rooms/:roomId/configure (решение №9).
- `packages/sdk/src/membership/roster-entry.ts` — `rosterRoleSchema` (enum lowercase: organizer/moderator/participant/spectator), `RosterRole`, `rosterEntrySchema` (strictObject: `identityId: uuid`, `displayName: string nullable`, `role`), `RosterEntry`, `rosterResponseSchema` (`{ members: RosterEntry[] }`), `RosterResponse`. Для GET /rooms/:roomId/members (решение №10).
- `packages/sdk/src/rewards/list-prizes-response.ts` — `listPrizesResponseSchema` (`{ prizes: PrizeResponse[] }`, переиспользует `prizeResponseSchema`) + `ListPrizesResponse`. Для GET /rooms/:id/prizes (дизайн §2).
- `packages/sdk/src/index.ts` — три строки `export *`, каждая в своей группе (membership, room, rewards), по существующему стилю файла.

## Tests written and results

Three contract-spec files in the existing it.each precedent style:

- `configure-room-request.contract.spec.ts` — 4 кейса из брифа verbatim (valid / extra key / settings не объект / bad appId).
- `roster-entry.contract.spec.ts` — 4 кейса из брифа verbatim (valid / swept guest displayName null / uppercase role rejected / extra key).
- `list-prizes-response.contract.spec.ts` — развёрнут из комментария-скетча брифа в тот же it.each стиль: valid с одним призом, пустой массив валиден, extra key на верхнем уровне, extra key внутри prize-записи, отсутствие обязательного поля `quantity`. Обязательные поля prize взяты из `prize-response.ts` (id, roomId, name, quantityTotal, quantity, createdAt, updatedAt); UUID в v4-форме (RFC 9562 nibble) по комментарию-прецеденту из create-room-response.contract.spec.

## TDD Evidence

**RED** — `pnpm --filter @mymozhem/sdk test` после написания только спек:

```
FAIL src/room/configure-room-request.contract.spec.ts
  TS2307: Cannot find module './configure-room-request'
FAIL src/rewards/list-prizes-response.contract.spec.ts
  TS2307: Cannot find module './list-prizes-response'
FAIL src/membership/roster-entry.contract.spec.ts
  TS2307: Cannot find module './roster-entry'
Test Suites: 3 failed, 26 passed, 29 total
```

Ожидаемо: схемы ещё не существуют, падают ровно три новых сьюта на разрешении импортов.

**GREEN** — `pnpm --filter @mymozhem/sdk test && pnpm --filter @mymozhem/sdk build` после реализации:

```
Test Suites: 29 passed, 29 total
Tests:       327 passed, 327 total
$ tsc -p tsconfig.json   (exit 0, без вывода)
```

327 = 314 (было) + 13 новых ассертов.

## Files changed (commit a5bb8de)

- Create: `packages/sdk/src/room/configure-room-request.ts`
- Create: `packages/sdk/src/room/configure-room-request.contract.spec.ts`
- Create: `packages/sdk/src/membership/roster-entry.ts`
- Create: `packages/sdk/src/membership/roster-entry.contract.spec.ts`
- Create: `packages/sdk/src/rewards/list-prizes-response.ts`
- Create: `packages/sdk/src/rewards/list-prizes-response.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts` (+3 строки экспорта)

## Self-review findings

- Полнота: все Produces-интерфейсы из брифа экспортированы (`configureRoomRequestSchema`, `ConfigureRoomRequest`; `rosterRoleSchema`, `RosterRole`, `rosterEntrySchema`, `RosterEntry`, `rosterResponseSchema`, `RosterResponse`; `listPrizesResponseSchema`, `ListPrizesResponse`).
- Коллизий имён с существующими экспортами нет (grep по `RosterRole|ConfigureRoomRequest|ListPrizesResponse` — чисто; `export *`-сборка tsc прошла).
- YAGNI: только три схемы задачи, без заделов под отложенные контуры.
- Тесты проверяют поведение: strictObject-строгость на обоих уровнях вложенности (response и prize-entry), nullable displayName (TTL-свип кейс), lowercase wire-роли, форма settings без семантической валидации (она — app-registry, REQ-CORE-007).
- Diff чистый: 7 файлов, +87 строк, ничего постороннего (git status до коммита подтверждён).

## Concerns

Нет.
