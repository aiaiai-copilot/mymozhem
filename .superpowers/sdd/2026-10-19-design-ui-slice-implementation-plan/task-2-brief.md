### Task 2: Core — `EventLogModule` + коммит `member.joined` в join

**Files:**
- Create: `packages/core/src/realtime/event-log.module.ts`
- Modify: `packages/core/src/realtime/realtime.module.ts` (провайдеры RealtimeBus/EventOutbox/EventLogService/EventEmitLimiter выносятся; += imports/exports EventLogModule)
- Modify: `packages/core/src/membership/membership.module.ts` (imports += EventLogModule)
- Modify: `packages/core/src/membership/membership.service.ts` (join:203-268; конструктор :35-43)
- Test: `packages/core/src/membership/membership.service.int-spec.ts`; `apps/server/test/realtime.e2e-spec.ts`

**Interfaces:**
- Consumes: T1 (`coreEventType('member.joined')`, схема в CORE_EVENTS).
- Produces: `EventLogModule` (imports `PrismaModule, ConfigModule, MetricsModule`; providers `RealtimeBus, EventOutbox, EventLogService, EventEmitLimiter` — фабрика лимитера переезжает verbatim; exports все четыре). `RealtimeModule` реэкспортирует `EventLogModule` (потребители Room/Rewards/AppRuntime не меняются). `MembershipService` конструктор += `EventOutbox, EventLogService` (последними параметрами). Потребители: ручные конструирования `MembershipService` в int-спеках (см. шаг 4).

Контекст (из разведки): AppRegistryService — global (AppRegistryModule.register), EventLogModule его не импортирует; в unit/int-спеках модули собираются вручную — сборка `EventLogService` по прецеденту `membership.service.int-spec.ts:49-68`.

- [ ] **Step 1: Failing int-test** — `membership.service.int-spec.ts`: после успешного guest-join `readRoomLog` содержит `core.member.joined` с `payload.identityId === identity.id`, `actorId === identity.id`, visibility `public`; spectator-join тоже эмитит; отказанный join (exclusion по IP) события НЕ даёт.
- [ ] **Step 2:** `pnpm --filter @mymozhem/core test:int -- membership.service` (форма без `--`, фильтр проверить на >0 матчей) — RED.
- [ ] **Step 3: Рефактор-модуль.** Создать `event-log.module.ts` (провайдеры/экспорты по Interfaces); `realtime.module.ts`: убрать перенесённые провайдеры, imports/exports += `EventLogModule`. Прогон `pnpm test:int` (core) + `pnpm build` — всё зелёное до изменения поведения (рефактор под существующими тестами).
- [ ] **Step 4: Коммит в join.** `MembershipService` конструктор += `EventOutbox, EventLogService`; тело tx в `join()` (`prisma.$transaction`, :251-267) оборачивается в `this.outbox.run(async (tx) => …)`, последним шагом в tx — `commitCoreEvent(tx, room.id, 'member.joined', { identityId: identity.id }, identity.id)` (advisory lock leaf-most — коммит после всех записей; конвенция HANDOFF). Обновить ручные конструирования `MembershipService` в int-спеках (grep `new MembershipService`): добавить сборку EventOutbox/EventLogService по прецеденту того же файла (:49-68). **DI-рипл:** тестовые модули, импортирующие `MembershipModule` (guest-sweep.int-spec, rewards.int-spec, transport-спеки), теперь транзитивно тянут `EventLogService` → `AppRegistryService`; где нет глобального `AppRegistryModule.register` — добавить `AppRegistryModule.register([])` по прецеденту `rooms-lifecycle.controller.int-spec.ts` (тот же класс связки через RoomModule→RealtimeModule там уже решён).
- [ ] **Step 5:** int-test GREEN; `pnpm test` (core unit) GREEN.
- [ ] **Step 6: Failing e2e** — `apps/server/test/realtime.e2e-spec.ts`: подписанный гость получает live `core.member.joined` (хелпер `waitEvent(socket, REALTIME_MESSAGES.EVENT)`, :147-149), когда второй гость join'ится по HTTP; payload.identityId совпадает с identityId из join-ответа второго. RED → реализация уже на месте (шаг 4) → GREEN. Порядок: waiter навешивается ДО HTTP-join (опыт Quiz-среза: live-кадр может прийти раньше ack).
- [ ] **Step 7:** Полные гейты: `pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm boundary-check && pnpm guardrails`. Внимание: логи e2e теперь содержат `member.joined` — seq-плотность ассертится относительно baseline (ruling ф.2), PII-цикл quiz-points не затронут (payload id-only); абсолютные seq-ассерты, если всплывут, правятся под новый baseline.
- [ ] **Step 8: Commit** `feat(core): member.joined — публичное событие ядра при join (EventLogModule выносит EventOutbox/EventLogService из RealtimeModule)`.

