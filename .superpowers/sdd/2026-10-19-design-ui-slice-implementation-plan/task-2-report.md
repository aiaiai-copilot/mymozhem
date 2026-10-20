# Task 2 report: Core — `EventLogModule` + коммит `member.joined` в join

**Status:** DONE. Commit: `260a164ad28b338eadba438df7bad7d5505a54f2` (branch `design-ui-batch-a`).

## Шаги

### Step 1–2: Failing int-test (RED observed)
- `packages/core/src/membership/membership.service.int-spec.ts`: новый describe `core.member.joined — публичное событие ядра при join (UI-срез, Task 2)` — 3 теста: guest-join (payload.identityId, actorId, visibility public, единственное событие в логе), spectator-join, отказанный join (rejoin-блок exclusion по IP → в логе остаётся ровно 1 событие первого, успешного join).
- Команда: `pnpm --filter @mymozhem/core test:int -- membership.service` → **RED: 3 failed, 42 passed** (все три новых теста падают на отсутствии события в логе).

### Step 3: Рефактор-модуль (green under existing tests)
- Создан `packages/core/src/realtime/event-log.module.ts`: imports `[PrismaModule, ConfigModule, MetricsModule]`; providers — фабрика `EventEmitLimiter` (verbatim из RealtimeModule), `RealtimeBus`, `EventOutbox`, `EventLogService`; exports все четыре. socket.io не импортируется (REQ-RT-006); `AppRegistryService` — global, в imports нет (по брифу).
- `packages/core/src/realtime/realtime.module.ts`: перенесённые провайдеры убраны; imports += `EventLogModule`; exports = `[EventLogModule]` (реэкспорт — потребители Room/Rewards/AppRuntime не тронуты, проверено typecheck'ом).
- Прогон до изменения поведения: `pnpm build` (6/6) + `pnpm --filter @mymozhem/core test:int` → **220 passed, 3 failed (только новые RED-тесты)** — рефактор поведенчески нейтрален.

### Step 4: Коммит события в join
- `membership.service.ts`: конструктор += `EventOutbox, EventLogService` (последние параметры); тело tx в `join()` обёрнуто в `this.outbox.run(async (tx) => …)`; последний шаг tx — `this.eventLog.commitCoreEvent(tx, room.id, 'member.joined', { identityId: identity.id }, identity.id)` (advisory lock leaf-most — после всех записей, конвенция HANDOFF).
- `membership.module.ts`: imports += `EventLogModule` (напрямую, не через RealtimeModule — иначе DI-цикл MembershipModule ↔ RealtimeModule).

### Step 5: GREEN
- `pnpm --filter @mymozhem/core test:int -- membership.service` → **45/45 passed**.
- `pnpm --filter @mymozhem/core test` (unit) → **230/230 passed**.

### Step 6: e2e live-доставка
- `apps/server/test/realtime.e2e-spec.ts`: новый тест «guest join по HTTP → подписчику приходит live core.member.joined: public, id-only payload, actorId второго гостя». Waiter (`waitEvent(socket, REALTIME_MESSAGES.EVENT)`) навешен **до** HTTP-join (опыт Quiz-среза); identityId второго гостя получен из `tokens.verifyAccessToken` его join-ответа.
- Отдельный RED для e2e не наблюдался: реализация уже была на месте после шага 4 — ровно порядок, предусмотренный брифом («RED → реализация уже на месте (шаг 4) → GREEN»). RED был зафиксирован на int-уровне (шаг 2). Тест зелёный.

### Step 7: Гейты (все зелёные)
- `pnpm build` — 6/6.
- `pnpm lint` — 6/6.
- `pnpm typecheck` — 10/10.
- `pnpm test` — sdk 329, core unit 230, app-lottery 39, app-quiz 86, server (unit+e2e) 71 — все passed.
- `pnpm test:int` — core 223/223 (220 baseline + 3 новых).
- `pnpm boundary-check` — no dependency violations (747 modules); циклов нет; socket.io остался только в gateway-коде.
- `pnpm guardrails` — all guardrails verified alive.

### Step 8: Commit
- `260a164` — сообщение verbatim из брифа + `Co-Authored-By: Claude Code <noreply@anthropic.com>`. 15 файлов: 14 modified + 1 created (`event-log.module.ts`).

## Все сайты ручного `new MembershipService` (17 штук, все обновлены: += outbox, eventLog/eventLog-инстанс на том же outbox)
1. `packages/core/src/membership/membership.service.int-spec.ts` — 4 сайта: `makeMembership` (:35), RoomService в beforeAll (:60), `makeMembership2` (:401), RoomService2 (:418).
2. `packages/core/src/room/room.service.int-spec.ts` — 2 сайта (:43 `makeService`, :575 empty-registry вариант, оба на своих outbox'ах).
3. `packages/core/src/auth/token.service.int-spec.ts` (:37 — outbox переупорядочен выше membership и разделён с RoomService).
4. `packages/core/src/app-runtime/app-runtime.int-spec.ts` (:244 — использованы существующие `outbox`/`eventLog`).
5. `packages/core/src/realtime/event-outbox.int-spec.ts` (:71 — `outbox, eventLog`).
6. `packages/core/src/realtime/event-commit.int-spec.ts` — 3 сайта (:84 и :406 — `outbox, eventLog`; :319 — `outbox, limitedLog`).
7. `packages/core/src/realtime/event-log.int-spec.ts` (:40 — новый EventLogService на общем outbox).
8. `packages/core/src/realtime/db-down.int-spec.ts` (:81 — `outbox, eventLog` в `wire()`).
9. `apps/server/test/xff-forwarded-for.e2e-spec.ts` (:99).
10. `apps/server/test/transport.e2e-spec.ts` (:132).
11. `apps/server/test/realtime.e2e-spec.ts` (:192 — `outbox, eventLog`).

## DI-рипл: сайты с добавленным `AppRegistryModule.register([])`
**Ни одного.** Обследование показало: все тестовые модули, импортирующие `MembershipModule` (guest-sweep.int-spec, rewards.int-spec, rewards.controller.int-spec, members.controller.int-spec, rooms-lifecycle.controller.int-spec), уже импортируют `RealtimeModule` и уже зовут `AppRegistryModule.register(...)` — зависимость `EventLogService → AppRegistryService` существовала транзитивно через RealtimeModule и до рефактора, поэтому перенос провайдеров в EventLogModule + дуга MembershipModule → EventLogModule ничего не добавили. Подтверждено зелёными полными прогонами int (23 сьюта) и server e2e (10 сьютов, включая boot реального AppModule).

## Seq-baseline правки (ruling ф.2) — 3 места, все в `apps/server/test/realtime.e2e-spec.ts`
1. `late-join replay` (:244): snapshot-типы `['core.room.activated']` → `['core.room.activated', 'core.member.joined']` — join гостя легально в логе и public.
2. `replay-видимость` (:408–409): participant `['core.room.activated', 'core.member.joined']`; organizer `['core.room.activated', 'core.member.joined', 'test-app.round.hinted']` (порядок по seq).
3. `/metrics` (:329): `publish_to_deliver{visibility="public"}` — observe в `fanOut` происходит per-commit независимо от числа подписчиков, поэтому HTTP-join сам даёт +1; baseline перенесён с начала теста на `during` (после join, до publish) — ассерт по-прежнему «ровно +1 за publish». В core int-спеках абсолютные seq-ассерты не сломались (join перед ними нигде не выполняется) — правок не потребовалось.

## Self-review
- TDD-порядок брифа выдержан: RED (int) → рефактор под зелёными → поведение → GREEN → e2e → гейты.
- Контракт события: payload строго `{ identityId }` (z.strictObject в SDK, Task 1); visibility public из реестра CORE_EVENTS; actorId — identity.id гостя (серверный контекст, не payload — REQ-RT-009 не задет).
- Атомарность «join + лог» — та же tx через `outbox.run` (REQ-DEV-008); отказанные join'ы (лимитер, denial-ветки, exclusion, participant-limit) бросают до tx → события нет (покрыто тестом на exclusion; denial-ветки структурно до tx).
- Boundary: EventLogModule без socket.io; depcruise чист; file-level циклов нет (realtime.module → membership.module → event-log.module, обратных дуг нет).
- Новых npm-зависимостей нет; lockfile не тронут.

## Concerns
- `member.joined` коммитится и при join в DRAFT-комнату (join по коду разрешён в DRAFT): `commitCoreEvent` не имеет status-гейта — это соответствует существующей семантике core-пути (без recheckRoomActive) и нужно live-ростеру предстартовой комнаты. Отдельного решения не требует, фиксирую для ревьюера.
