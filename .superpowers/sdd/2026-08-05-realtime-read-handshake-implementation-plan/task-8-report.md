# Task 8 report — e2e realtime (apps/server, socket.io-client)

**Статус: DONE** (после решения владельца по boundary; изначально BLOCKED — см. хронологию).

Все тесты зелёные (unit + int + e2e 8/8), но `socketio-only-in-realtime` ловит
импорт `socket.io-client` в e2e-спеке. По инструкции диспатча — стоп, точный вывод
ниже, e2e-артефакты не закоммичены, решение за владельцем.

## Исходное состояние сессии

Работа Task 8 была начата предыдущей сессией и оставлена незакоммиченной:
- `packages/core/src/realtime/realtime.gateway.ts` — санкционированный фикс
  (try/catch в handleSubscribe → ack через `wireCodeOf`, helper переиспользован,
  не продублирован) уже присутствовал;
- `packages/core/src/realtime/realtime.gateway.spec.ts` — unit-тест containment
  (findActiveMembership rejects → ack ровно `{code:'INTERNAL_ERROR'}`, throw не
  улетает, logger.error ×1) уже присутствовал;
- `packages/core/src/realtime/io-adapter.ts` + `apps/server/src/main.ts` — фикс
  «httpServer передаётся в адаптер явно» (без него socket.io слушал отдельный
  случайный порт; баг затрагивал и production main.ts) уже присутствовал;
- `apps/server/package.json` — devDep `socket.io-client@^4.8.3` уже добавлен,
  `pnpm-lock.yaml` обновлён (Step 1 brief был фактически выполнен);
- `apps/server/test/realtime.e2e-spec.ts` — существовал verbatim по brief, с
  **named import `AppRegistryService`** (предпочтительная форма из примечания
  brief — работает, оставлена; dynamic import не понадобился).

## Per-step

### Санкционированный фикс (леджер Task 7 → Task 8)
- `pnpm --filter @mymozhem/core test realtime.gateway` → **16/16 PASS**
  (15 исходных + 1 новый containment-тест). Помечено комментарием в коде как
  санкционированный фикс.

### Step 3: build + e2e — два реальных бага, найденных и исправленных

Первый прогон `pnpm --filter @mymozhem/server test realtime`: **3 passed / 5 failed**
(таймауты 180 с у live-тестов, INTERNAL_ERROR у replay).

**Баг A — ORG-литерал brief невалиден для zod v4.** `z.uuid()` (zod v4) требует
RFC 9562 version nibble 1–8 (кроме nil/max); `'00000000-0000-0000-0000-000000000001'`
имеет версию 0 → `projectedEventSchema.parse` падал на `core.room.activated`
(actorId = ORG) → subscribe отвечал INTERNAL_ERROR. Фикс в спеке:
`ORG = '00000000-0000-4000-8000-000000000001'` (валидный v4) с комментарием.
Отклонение от verbatim brief, необходимое: без этого не проходит ни один
subscribe-тест. Отмечено: те же невалидные UUID-литералы используются в core
int-specs (event-log/event-outbox) — там они не проходят через z.uuid() и не
мешают; оставлены как есть (внимание Task 9).

**Баг B — live-доставка молча пропадала (корневой баг ядра, Task 5).**
Систематическая локализация (временный DEBUG-тест, удалён после):
ручной `server.to(room).emit` доходит; ручной `bus.publish([строка из findFirst])`
доходит и проецируется; тап bus-эмиттера показал, что реальный флоу публикует
событие; трасса fanOut показала `visibility: "public"` (lowercase) у staged
события против `"PUBLIC"` у прочитанного через Prisma-клиент.
**Корень:** `EventLogService.appendLocked` использует `$queryRaw ... RETURNING *`,
который обходит клиентское маппирование enum (`PUBLIC @map("public")` в
schema.prisma) — staged `LogEvent.visibility` содержал сырую DB-метку `'public'`,
а `fanOut` сравнивает с `'PUBLIC'`/`'ORGANIZER'` → молчаливая недоставка ВСЕХ
live-событий (app и core lifecycle). Replay не затронут (читает через
Prisma-клиент). Unit/int-тесты Task 5 это не ловили: outbox int-spec проверял
только типы доставленных событий, не visibility.
**Фикс** (`packages/core/src/realtime/event-log.service.ts`, файл Task 5 —
отклонение за пределами списка файлов brief, обоснование: критерий ф.1
«видимость по каналу realtime» недостижим без него; фикс минимален и покрыт
регрессионным тестом): нормализация `asLogEvent()` (мапа DB-метка → Prisma-enum)
перед stage/return. **Регрессионный тест** добавлен в
`packages/core/src/realtime/event-outbox.int-spec.ts`: доставленные события
несут Prisma-enum visibility `'PUBLIC'`.

### Финальные прогоны (все зелёные)
- `pnpm --filter @mymozhem/core test` → **161/161 PASS** (14 suites)
- `pnpm --filter @mymozhem/core test:int event-outbox` → **7/7** (включая новый
  регрессионный); `test:int event-log` → **5/5**
- `pnpm build` → OK, dist проверен (VISIBILITY_FROM_DB, Error containment присутствуют)
- `pnpm --filter @mymozhem/server test` → **23/23 PASS** (health + transport +
  realtime, 3 suites, ~5 с — таймауты исчезли)
- `pnpm --filter @mymozhem/server test realtime` → **8/8 PASS**, >0 матчей:
  late-join replay ✓, publish→live+actorId ✓, ROOM_LOG_SEALED ✓, видимость live
  (organizer/module-private) ✓, guest scope ✓, SESSION_INVALID ✓,
  reconnect-потолок RATE_LIMITED ✓, revokeRoomAccess ✓
- `pnpm lint` / `pnpm typecheck` → green
- `pnpm guardrails` → все три гардрейла живы

### Step 4: commit — ОСТАНОВЛЕНО boundary-check

`pnpm boundary-check` → exit 1, точный вывод:

```
  error socketio-only-in-realtime: apps/server/test/realtime.e2e-spec.ts → node_modules/.pnpm/socket.io-client@4.8.3/node_modules/socket.io-client/build/cjs/index.js

x 1 dependency violations (1 errors, 0 warnings). 366 modules, 1034 dependencies cruised.
```

Правило (`.dependency-cruiser.cjs`): `from.pathNot: ['^packages/core/src/realtime', '[/\\\\]dist[/\\\\]']`,
`to.path: 'node_modules/socket[.]io'` — regex матчит и `socket.io-client`.
По диспатчу правило НЕ ослаблялось; e2e-спека, devDep и lockfile оставлены
незакоммиченными в рабочем дереве.

Закоммичены только проверенные фиксы ядра (валидны при любом решении по e2e):

**commit `2d4799a`** — `fix(core): realtime — containment handleSubscribe, httpServer
в io-adapter, нормализация visibility staged-событий` (gateway + spec, io-adapter,
main.ts, event-log.service, event-outbox.int-spec; 6 файлов).

## Отклонения от brief (сводка)
1. **Санкционированное** (леджер Task 7→8): containment в handleSubscribe — уже
   было внесено предыдущей сессией, верифицировано, вошло в `2d4799a`.
2. **ORG-литерал** в e2e-спеке заменён на валидный v4 UUID (zod v4) — без этого
   спека не работает; verbatim brief здесь дефектен.
3. **Фикс за пределами списка файлов**: `event-log.service.ts` (нормализация
   visibility) + регрессионный тест в `event-outbox.int-spec.ts` — корневой баг
   live-доставки; без него критерии ф.1 не подтверждаются. Требует adjudication.
4. **io-adapter/main.ts httpServer** — внесено предыдущей сессией, подтверждено
   необходимостью (иначе socket.io на отдельном порту); задокументировано
   комментарием в коде.
5. **Named import `AppRegistryService`** использован (предпочтительная форма
   примечания brief) — работает.

## Варианты для владельца (разблокировка e2e)
- (a) Уточнить правило: `to.path: 'node_modules/socket[.]io/'` с `$`-якорем пакета
  (исключить `-client`) — по аналогии с adjudicated dist-исключением Task 7;
  намерение REQ-RT-006 — единственное место импорта server-библиотеки socket.io,
  тестовый клиент транспорта не реализует.
- (b) Добавить `apps/server/test` в `from.pathNot` этого правила.
- (c) Переписать e2e на сырой ws/engine.io клиент — тяжело и проверяет меньше
  реального контракта (не рекомендуется).

После решения: `git add apps/server/test/realtime.e2e-spec.ts apps/server/package.json pnpm-lock.yaml`
и commit сообщением brief: `test(server): realtime e2e — replay, видимость live,
publish, reconnect-потолок, revoke-hook (критерии ф.1)`.

## Разрешение boundary (решение владельца, та же сессия)

Владелец выбрал вариант (a): якорь правила на server-пакет. Изменение в
`.dependency-cruiser.cjs`: `to.path` правила socketio-only-in-realtime
`'node_modules/socket[.]io'` → `'node_modules/socket[.]io[/\\\\]'` (+ комментарий
с обоснованием: REQ-RT-006 про server-библиотеку; socket.io-client — тестовый
клиент провода).

- `pnpm boundary-check` с e2e-спекой в дереве → **green** (366 modules, 0 violations).
- **Probe живучести**: временный `packages/core/src/room/probe-socketio.ts`
  (`import 'socket.io';`) → правило сработало:
  `error socketio-only-in-realtime: packages/core/src/room/probe-socketio.ts → node_modules/.pnpm/socket.io@4.8.3/node_modules/socket.io/dist/index.js`
  (1 error, exit 1). Probe удалён, повторный прогон → green.
- `pnpm guardrails` → все три гардрейла живы.

**Commit `1c28137`** — `test(server): realtime e2e — replay, видимость live,
publish, reconnect-потолок, revoke-hook (критерии ф.1)` (сообщение brief verbatim
+ trailer; тело упоминает якорь правила). Файлы: `apps/server/test/realtime.e2e-spec.ts`,
`apps/server/package.json`, `pnpm-lock.yaml`, `.dependency-cruiser.cjs`.

Финальное состояние ветки: `2d4799a` (фиксы ядра) + `1c28137` (e2e + boundary
anchor); рабочее дерево чистое; тестовое состояние закоммиченного кода =
проверенное выше (core unit 161/161, int 12/12, server e2e 23/23, realtime 8/8;
lint/typecheck/boundary-check/guardrails green).

## Final-review fix wave (owner-sanctioned I-1 + M-1, commit 3483503)

**FIX 1 (I-1, Important) — join-first в handleSubscribe.**
`packages/core/src/realtime/realtime.gateway.ts`: registry.add + socket.join
(roomChannel + organizerChannel при organizer) перенесены с конца обработчика
(после построения snapshot) на позицию сразу после вычисления level — ДО
`prisma.room.findUnique` / `logEvent.findMany`. Все гейты (schema, guest-scope
REQ-ID-016, multi-subscription, membership REQ-SEC-003) остались до join.
Комментарий в коде фиксирует порядок design §4 и trade-off: гонка «коммит между
чтением и join» теперь даёт дубликат (live + snapshot) вместо незаметной потери
(seq/cursor нет, REQ-RT-011a) — accepted duplicate-acceptance cursor-less MVP.
Containment-catch (санкционированный ранее) усилен откатом полуподписки:
`registry.remove(socket.id)` + `leave` обоих каналов — иначе клиент с ack-ошибкой
при сбое join/чтения продолжал бы получать live-поток. Комментарий отмечает, что
до join remove/leave — безвредные no-op.

**Тесты FIX 1:** новый unit-тест в `realtime.gateway.spec.ts`
('join failure after registry.add leaves no stale subscription'): join бросает →
ack ровно `{code:'INTERNAL_ERROR'}`, `registry.get('socket-1')` undefined,
`socket.left` = оба канала, throw не улетает. Существующие unit/e2e-ассерты
порядок-агностичны и остались зелёными.

**FIX 2 (M-1) — e2e replay-видимости.**
`apps/server/test/realtime.e2e-spec.ts`: в фикстурный манифест TEST_APP добавлено
organizer-аннотированное свойство `orgNote` (`'x-visibility': 'organizer'`) и в
settings хелпера — `orgNote: 'o'` (assert late-join участника неизменен:
orgNote ему не виден). Новый тест 'replay-видимость: snapshot участника — только
public, организатора — public+organizer, module-private никому
(REQ-CORE-005/008)': participant-паблишер пре-коммитит `test-app.round.hinted`
(organizer) и `test-app.secret.recorded` (module-private) ДО подключения
подписчиков; затем participant и organizer подписываются и проверяется:
participant snapshot events = `['core.room.activated']`, organizer =
`['core.room.activated', 'test-app.round.hinted']`, module-private ни у кого;
appSettings participant = `{label:'live'}`, organizer = `{label:'live', orgNote:'o'}`,
`answers` (неаннотированное → module-private, fail-safe) ни у кого.

**Команды и результаты (все green):**
- `pnpm --filter @mymozhem/core test realtime.gateway` → 17/17 PASS (16 + новый
  cleanup-тест)
- `pnpm build` → OK (dist пересобран)
- `pnpm --filter @mymozhem/server test` → 24/24 PASS (3 suites: health, transport,
  realtime); `pnpm --filter @mymozhem/server test realtime` → 9/9 PASS, >0 матчей,
  включая новый replay-visibility тест
- `pnpm lint` / `pnpm typecheck` → green; `pnpm boundary-check` → 0 violations

**Commit `3483503`** — `fix(core): subscribe join до чтения лога (дизайн §4,
duplicate-acceptance) + e2e replay-видимости` (3 файла: gateway, gateway spec,
e2e spec).
