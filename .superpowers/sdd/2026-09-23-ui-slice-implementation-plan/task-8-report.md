# Task 8 — отчёт: Realtime-клиент (`src/realtime/`)

## Что реализовано

Ровно по brief, без отклонений от заданной формы кода:

- `apps/web/src/realtime/socket-like.ts` — единственный импортёр `socket.io-client` в apps/web (boundary `web-socketio-only-in-realtime`). Экспортирует интерфейс `SocketLike` и фабрику `createSocket(getAccessToken)`: same-origin `io()` (дизайн §0.3), токен читается на каждый handshake через `auth: (cb) => cb({ token: getAccessToken() })` — reconnect уходит со свежим access-токеном.
- `apps/web/src/realtime/room-connection.ts` — `RoomConnection(socket, roomId)` + тип `ConnectionState = 'connecting' | 'live' | 'disconnected'`:
  - `join(): Promise<RoomSnapshot>` — subscribe с ack-валидацией `subscribeOkAckSchema`;
  - `onEvent(cb)` — payload парсится `projectedEventSchema` (дрейф → ZodError, fail-loud);
  - reconnect после join → re-subscribe → `onResync` со свежим snapshot (полный перефолд, дизайн §3); первый connect до join → no-op (`joined=false`), только состояние `'connecting'`;
  - `publish(type, payload)` — request валидируется `publishRequestSchema`, ok-ack `publishOkAckSchema`, error-ack → `ApiError(code, 0)`;
  - `close()` → `socket.disconnect()`.
- Имена wire-сообщений — только через `REALTIME_MESSAGES` из SDK, литералов нет.
- Ошибки ack: `contractErrorPayloadSchema.parse(ack).code` → `ApiError` со статусом 0 (wire-уровень, HTTP-статуса нет). Непарсящийся ack → ZodError (дрейф контракта виден громко). Это согласуется с gateway: `wireCodeOf` всегда отдаёт код из `CONTRACT_ERROR_CODES` (`packages/core/src/realtime/realtime.gateway.ts`).

## Что протестировано

`apps/web/src/realtime/room-connection.spec.ts` — `FakeSocket implements SocketLike` (очередь программируемых ack по имени сообщения, триггеры `triggerConnect/triggerDisconnect/triggerEvent`, журнал вызовов):

1. `join: ok-ack → распарсенный snapshot; на провод ушёл subscribe с roomId` — snapshot deep-equal, payload ровно `{ roomId }`.
2. `join: error-ack { code } → ApiError с серверным кодом (wire-уровень, статус 0)` — `ACTOR_NOT_MEMBER`, status 0.
3. `onEvent: payload парсится в ProjectedEvent; дрейф контракта → ZodError (fail-loud)` — валидное событие доезжает; `{...event, seq: 42}` → ZodError синхронно из триггера.
4. `reconnect после join → re-subscribe → onResync со свежим snapshot` — второй subscribe тем же сообщением/roomId, resync получил fresh snapshot.
5. `state: join → "live"; disconnect → "disconnected"; reconnect после join → "live"` — последовательность `['live','disconnected','live']`.
6. `первый connect до join — no-op: "connecting", subscribe не уходит` (дополнительный к 6 brief'овым — поведение прямо оговорено в глобальных констрейнтах задачи).
7. `publish: ok-ack → resolve; error-ack → ApiError` — payload `{ type, payload }` на проводе; `ROUND_NOT_OPEN`, status 0.

### Результаты

- `pnpm --filter @mymozhem/web test` — **15 passed (15)**, 2 файла (8 api + 7 realtime), вывод чистый, без unhandled rejections.
- `pnpm --filter @mymozhem/web lint` — зелёный.
- `pnpm --filter @mymozhem/web typecheck` — зелёный.
- `pnpm boundary-check` — `✔ no dependency violations found (662 modules, 2038 dependencies cruised)`.

## TDD Evidence

**RED** (Step 2, после написания спеки до реализации):

```
$ pnpm --filter @mymozhem/web test
FAIL  src/realtime/room-connection.spec.ts
Error: Cannot find module './room-connection' imported from .../room-connection.spec.ts
 Test Files  1 failed | 1 passed (2)
```

Ожидаемо: спека импортирует `./room-connection` и `./socket-like`, которых ещё нет — сьют падает на резолве модуля, то есть тесты реально красные, а не зелёные случайно.

**GREEN** (Step 4, после реализации):

```
$ pnpm --filter @mymozhem/web test
 Test Files  2 passed (2)
      Tests  15 passed (15)
```

## Изменённые файлы (коммит `b318a23`)

- `apps/web/src/realtime/socket-like.ts` (новый)
- `apps/web/src/realtime/room-connection.ts` (новый)
- `apps/web/src/realtime/room-connection.spec.ts` (новый)

## Self-review findings

- Полнота: все 6 тестов brief'а + 1 на no-op первого connect (оговорён в констрейнтах задачи); все методы интерфейса из brief присутствуют; barrel-файл не создавал (YAGNI — потребитель Task 10 импортирует напрямую).
- Качество: комментарии по-русски и про «почему»; `SocketLike` в `room-connection.ts` импортируется как `import type` — спеки не тянут рантайм socket.io-client.
- Тесты проверяют поведение (wire-payload, состояния, перефолд), а не внутренности; флакинеса нет — никаких таймеров, кроме одного `setTimeout(0)` для слива микротасков в reconnect-сценариях.
- Concern (формой brief задано, не менял): в reconnect-ветке `void this.subscribeOnce().then(...)` — если re-subscribe получит error-ack, промис бросит `ApiError` без обработчика → unhandled rejection в консоли браузера. Серверная семантика (disconnect при ошибке subscribe) делает это маловероятным, но ревьюер/владелец может захотеть явный `.catch`. Не блокирует: форма кода задана brief'ом дословно.
- Concern (информационно): `contractErrorPayloadSchema` требует код из `CONTRACT_ERROR_CODES` — код вне enum'а в error-ack даст ZodError, а не ApiError. Для realtime это соответствует gateway (все коды через `wireCodeOf` → enum), в отличие от REST static-режима с `NOT_FOUND`. Осознанное расхождение с «прозрачностью кодов» в api-error.ts, но оно задано brief'ом и серверным контрактом.

## Issues / concerns

См. два пункта выше. Блокеров нет.
