# HANDOFF

**Date:** 2026-09-02 (срез исключения **исполнен 9/9 и слит в `main`** — мердж `--no-ff` `c2e60da`; все гейты зелёные на слитом результате; **push — решение владельца**)
**Branch:** `main` (16 коммитов впереди `origin/main`, не запушен; рабочее дерево чистое). Ветка `feat/membership-exclusion` удалена после мерджа.

**Состояние фазы 1.** SDK contract core, сервис регистрации манифеста, Room lifecycle, Identity minimal seam, Lifecycle-эмит в лог, appSettings write path, Membership/guest-join, транспортный auth/HTTP, event-commit, realtime read/handshake (полный duplex), membership-exclusion (исключение участника + немедленный отзыв доступа, rejoin-блок по IP) — реализованы и слиты в `main`. Критерии выхода ф.1 по realtime и по исключению (ф.1 «немедленный отзыв подписки») подтверждены e2e на проводе. Леджеры исполнения срезов: `.superpowers/sdd/*/progress.md` (не в git, только на этой машине). Этап продукта — MVP. Метод — AIDD / Specification-Driven.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. Этот файл целиком.
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `.superpowers/sdd/*/progress.md` — леджеры исполнения прежних срезов (не в git, только на этой машине; `git clean -fdx` уничтожит). Леджера среза исключения на машине нет — его история: план + `git log` (диапазон `89d887f..c2e60da`).
6. `docs/sessions/2026-08-18-membership-exclusion-{design,implementation-plan}.md` — исполненные дизайн+план среза исключения (9/9, работа в коммитах; читать при разборе истории, §0 дизайна — решения владельца).
7. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы и дизайны прежних срезов (включая realtime: `docs/sessions/2026-08-05-realtime-read-handshake-{design,implementation-plan}.md`) читать при разборе истории — их работа в коммитах. Состояние на конец прошлой сессии: `git show 4cab30c:HANDOFF.md`.

## Следующее действие

**Срез исключения закрыт (9/9, мердж `c2e60da`, гейты зелёные). Следующий срез — выбор владельца**: OAuth (`POST /rooms` + Google-флоу, REQ-ID-015/009; follow-up про `TokenService.sessionExpiry()` guest-cap — в списке ниже) либо иной.

Перед/вместе со стартом нового среза: `git push` `main` (16 коммитов впереди `origin/main`) — решение владельца.

**Остаточные риски, принятые мерджем (realtime-срез):**
- **Duplicate-acceptance в subscribe** (осознанный trade-off дизайна §4): join каналов — ДО чтения лога, поэтому событие, закоммиченное между join и чтением, придёт и live, и в snapshot. Клиент без seq/cursor (REQ-RT-011a) дедуплицировать не может — принято для MVP; ссылка для фазовой работы над курсором (ф.4).
- **Deferred-миноры финального ревью (ride, триаж «не гейтят»):** M-2 — мёртвая инжекция `config` в RealtimeGateway (убрать при следующем касании); M-4 — cross-socket timing в live-visibility e2e (микроскопическое окно флейка; маркер на organizer-сокете сделает детерминированным); M-5 — `asLogEvent` fallback fail-open (`?? row.visibility`) — fail-closed throw при следующем расширении enum EventVisibility. (M-3 — stale registry entry — **закрыт срезом исключения**, `74035f9`.)
- Риски прошлых срезов (refresh-ротация strict, access-токены ≤15 мин после терминации, `/health/ready` 503) неизменны — `git show 3d7de83:HANDOFF.md`.

**Санкционированные владельцем отклонения от плана этого среза** (все прошли ревью, зафиксированы в леджере):
1. fanOut изолирует per-event доставку try/catch + server log (иначе бросок слушателя отклонял бы `outbox.run` ПОСЛЕ коммита) — с тестом.
2. handleSubscribe error-containment: try/catch → ack `{code:'INTERNAL_ERROR'}` через общий `wireCodeOf` (плановый код отдавал unhandled rejection — риск падения единственной реплики) — с тестом.
3. `EventLogService.appendLocked`: нормализация `asLogEvent` — staged-события из `$queryRaw RETURNING *` несли raw-метку enum (`'public'`), не Prisma-имя (`'PUBLIC'`); fanOut молча ронял ВСЮ live-доставку (replay не затронут) — с регрессионным int-тестом.
4. `ConfigurableIoAdapter` принимает Nest httpServer явно — без него socket.io слушал отдельный случайный порт (затрагивало и prod `main.ts`).
5. `.dependency-cruiser.cjs`: правило `socketio-only-in-realtime` — dist-исключение в pathNot (CI build→boundary-check ловил скомпилированные .d.ts) + якорь `to.path` на серверный пакет (`socket.io/` не матчит `socket.io-client`). Пробами подтверждено: на src-нарушениях правило срабатывает, guardrails живы.
6. Порядок subscribe: join до чтения лога (дизайн §4) — плановый verbatim-порядок был lossy (событие между чтением и join терялось молча); фикс финального ревью + e2e replay-видимости (M-1).

Опыт этой сессии для следующих:
- **zod v4 `z.uuid()` требует валидный version nibble.** Литералы вида `00000000-0000-0000-0000-...` НЕ проходят (версия 0). В старых core int-спеках такие есть (ORG/P1) — безвредны, пока не проходят через `z.uuid()`; в e2e на проводе ломают проекцию событий с таким actorId. Кандидат на чистку.
- **boundary-check круизит dist** (CI: build → boundary-check, `tsPreCompilationDeps`) — легальный type-import из свежего dist может зажечь правило; диагностировать до вывода «граница нарушена».
- e2e на проводе — ловец реальных багов среза: оба бага (raw-enum staged, отдельный порт io) всплыли только на живом socket.io-client, unit-фейки их не видели.
- Субагент может умереть на API-квоте (403 billing cycle) — повторный диспатч прошёл без изменений; леджер + report-файлы делают это безболезненным.

**Швы realtime-среза для будущих планов:**
- Шов дизайна §9 **закрыт**: срез исключения вызывает `RealtimeGateway.revokeRoomAccess(identityId, roomId)` через hook `onAccessRevoked`; реестр подписок и `socketsOf` потреблены.
- MODERATOR сейчас → уровень `public` (amendment v1.3); если права вырастут — пересмотреть маппинг уровня в `handleSubscribe`.
- Курсор replay (REQ-RT-011б) и метаданные seq — фаза 4; наружная форма события курсор структурно исключает (strictObject), эволюция — аддитивная через minor-версию контракта.
- Per-event re-check членства в live-доставке не делается (решение §0) — при исключении подписка рвётся через hook (реализовано), не через фильтрацию.

**Follow-up пакеты, подбираемые будущими планами явно:**
- **Чистка invalid-uuid литералов** в старых int-спеках (см. опыт выше) + fail-closed в `asLogEvent` (M-5) + удаление мёртвой инжекции config (M-2) — пакет косметики realtime.
- **Права эмита по ролям (SPECTATOR)** — app-семантика, фаза 2 (M-3 и мягкое удаление membership закрыты срезом исключения).
- **Для следующего среза, трогающего configure/app-registry** (из финального ревью appSettings): guard `settings === undefined|null` → `AppSettingsInvalidError`; `ValidateFunction` из `ajv/dist/2020`; race-тест configure-vs-activate с quiz@2; контрактное допущение «settings — не-null JSON value».
- **Для OAuth-среза:** `TokenService.sessionExpiry()` применяет guest-cap `min(REFRESH,GUEST_TTL)` безусловно — REGISTERED-ротация не должна его наследовать (token.service.ts, design §10).
- **Для web-client-среза:** CORS без `credentials: true` + SameSite=Strict — клиент с другого origin не сможет использовать refresh-куку (сейчас корректно для same-origin).
- Негативные strictObject-кейсы для ack-схем SDK (минор Task 2); экспорт realtime-фикстур из SDK index — при первом внешнем потребителе.
- Из membership/guest-join: гонка soft-delete/status-flip в `MembershipService.join` — принятый класс гонки (design fork (б)); JSDoc на `RoomService.create` про lowercase-in/Prisma-name-out.
- Deferred-миноры event-commit (ride): `eventValidatorFor` игнорирует schema-аргумент на cache-hit; некомпилируемая app-схема падает лениво (кандидат boot-time compile-check в app-registration срез); 6 точек ручного конструирования `EventLogService` в спеках дрейфуют (кандидат — test-module builder; после realtime-среза таких точек стало больше — вес вырос).

## Два гейта над фазами

1. **Юрист** — до первого события с посторонними или призами. Список вопросов готов (`docs/legal/questions-for-lawyer.md`). Блокирует старт работы с реальными PII, не блокирует реализацию.
2. **Первое живое событие** — до тяжёлых вложений в фазу 3 (rewards/лотерея).

## Долгоживущие ограничения, введённые срезами

- **Замороженные миграции:** `20260718061612_room_lifecycle`, `20260722151900_identity_seam`, `20260722153952_room_organizer_fk`, `20260722180147_realtime_log_event`, `20260723090841_room_app_config`, `20260729164500_membership_guest_join`, `20260730101037_auth_sessions`, `20260819154552_membership_exclusion`. Любое изменение — только новой миграцией.
- **Socket.io граница:** серверный `socket.io` импортируется только из `packages/core/src/realtime` (REQ-RT-006, правило dependency-cruiser с якорем на пакет `socket.io/`); `socket.io-client` — только `apps/server/test` (devDep). Правило круизит и dist (CI build→boundary-check) — в pathNot есть dist-исключение, осознанное.
- **Fan-out realtime:** publish в RealtimeBus — строго после коммита транзакции (`EventOutbox.run`); исключения слушателей изолированы в `fanOut` gateway (не отклоняют `run`); commit вне `outbox.run` бросает `EventOutboxMissingContextError` (fail-closed); вложенный `run` запрещён.
- **Subscribe:** join каналов — ДО чтения лога (duplicate-acceptance, дизайн §4); гейты (schema/guest-scope/мульти-подписка/membership) — до join; catch-путь чистит запись реестра.
- **Конвенция lockfile/CI:** один lockfile (REQ-DEV-002); CI порядок build → boundary-check.
- **Membership exclusion (срез 2026-09-02):** исключение — soft-delete membership (`deletedAt`) + строка `Exclusion` (unique(roomId,identityId), index(roomId,ip), FK RESTRICT) + отзыв guest-сессий — одной транзакцией; повторный exclude — typed no-op (идемпотентность). `findActiveMembership` гасит soft-deleted; deletedAt-гейт стоит и в `commitAppEvent`, и в `participantCount` (дочистка read-paths, `06c1019`). Rejoin-блок — по `joinIp` через `Exclusion` в `join` (REQ-ID-006 ч.3). Организатор неисключаем, его `joinIp = null` (nullable — санкционированное отклонение от дизайна §2).
- **Hook `onAccessRevoked` (MembershipService → RealtimeGateway):** тип `void | Promise<void>`, fan-out sequential-await, исключения слушателей изолированы (sync-throw и async-reject логируются, не роняют exclude). `RealtimeGateway.revokeRoomAccess` — sync `void`: разрыв подписки + leave каналов + отзыв сокета.
- **Barrel core:** `ActorNotMemberError` экспортируется realtime-версией (явный re-export в `index.ts`, TS2308 от одноимённых классов); membership-версия потребляется прямым путём модуля. Barrel-потребителей класса нет.
- **Prod-баррел core тянет testcontainers в require-time** (design §9 — осознанное расширение ради e2e). Безопасно, пока Dockerfile тащит полные `node_modules` в runtime-стейдж; упадёт при pruning devDependencies. Follow-up-кандидат: вынести testing в отдельный entry point (`@mymozhem/core/testing`); не давать workaround с dist-subpath-импортами (create-room.mjs) стать постоянным.
- **`NODE_OPTIONS=--experimental-vm-modules` зашит в test-скрипт apps/server** — `@fastify/cookie@11` динамически импортирует ESM-only `cookie@2`, что ломает jest 29 CJS. Изолирован в test-скрипте. Триггеры пересмотра: jest 30 или `@fastify/cookie` на `require(ESM)` (Node 24).
- **Refresh-кука `Secure` при `NODE_ENV=production`** — compose-смоук по plain HTTP не сможет round-trip куки cookie-jar клиентом; ассертить `Set-Cookie`-заголовок.
- **Конвенция порядка блокировок:** advisory lock комнаты — всегда leaf-most; транзакция, захватившая его, не должна после этого писать в `room."Room"`.
- **Prisma 7.8 adapter-pg ловушка:** `$queryRaw` не десериализует `void`-возвращающие выражения (`pg_advisory_xact_lock`) — использовать `$executeRaw`. Учитывать при написании будущих планов.
- **Prisma 7.8 adapter-pg: форма ошибок raw-запросов.** Падающий `$queryRaw` оборачивается в `PrismaClientKnownRequestError` с кодом `P2010`; SQLSTATE внутри message и `meta.driverAdapterError.cause.originalCode`. Матчить `code === 'P2010'` + подстроки (прецедент `isRoomCodeCollision`). Также: `$queryRaw` возвращает сырое DB-значение enum (`'public'`), а не Prisma-имя (`'PUBLIC'`) — для staged-событий нормализует `asLogEvent` (realtime-срез); при `RETURNING *` из raw INSERT — re-read через клиент (прецедент `insertRoom`) или явная нормализация.
- **Инвариант «change both or neither»:** предикат `kind = 'REGISTERED' AND deletedAt IS NULL` живёт в двух местах — частичный индекс `"Identity_registered_email_key"` и guarded INSERT в `RoomService.create`. Менять только вместе.
- **Хост-порты 5432 и 55432 заняты чужими контейнерами** (`lt-pg` и `lt-pg-sdd`, не проектные, не трогать). Authoring-контейнер миграций (`mm-migrate`, эфемерный) публиковать на свободный порт (в срезе исключения — 55433).
- **`prisma migrate dev` не всегда регенерирует клиент; явный `pnpm exec prisma generate` требует DATABASE_URL** и cwd = корень репозитория. Prisma 7 CLI вообще работает только из корня репо (`prisma.config.ts` там): форма `pnpm --filter @mymozhem/core exec prisma …` падает — использовать `pnpm exec prisma …` из корня.
- **`packages/core/src/testing/postgres.testcontainer.ts` — переиспользуемый паттерн ядра.** Мутирует глобальный `process.env.DATABASE_URL` без восстановления (безопасно только при `maxWorkers: 1`); требует cwd = корень репозитория.
- **Прогон интеграционной ланы поднимают контейнеры Postgres** (~8 с локально на файл). Docker Desktop должен быть запущен.
- **Jest CLI:** форма `pnpm --filter @mymozhem/core test:int -- -t "..."` миспарсится — рабочая форма без `--`. Фильтр всегда проверять на >0 матчей.
- **apps/server e2e резолвит `@mymozhem/core` из dist** — перед `pnpm --filter @mymozhem/server test` обязателен `pnpm build`; core резолвит `@mymozhem/sdk` из dist — после правок SDK `pnpm --filter @mymozhem/sdk build`.

## Отложенные follow-up (не гейтят; полный список с обоснованиями — в леджерах)

- **Вынести testing-экспорты из prod-баррела core** в отдельный entry point — при этом починить `create-room.mjs` обратно на баррел (его dist-subpath-импорты молча сломаются при появлении `exports` в core). После realtime-среза скрипт дополнительно конструирует RealtimeBus/EventOutbox.
- **`create-room.mjs`: findFirst по точному `email`, а индекс — по `lower(email)`** — при кейс-варианте будет сырая unique-violation вместо reuse.
- **`updateManyAndReturn` доступен на Prisma 7.8.0** — схлопнет 3 запроса в 2 в мутациях `RoomService` (transition/softDelete/configure). **Осторожно:** transition теперь работает внутри `outbox.run` с staging — рефакторинг не должен разорвать атомарность «UPDATE + лог + staged-доставка».
- **Нет гейта на дрейф миграций** (`prisma migrate diff --from-migrations` непригоден без `datasource.shadowDatabaseUrl` в `prisma.config.ts`).
- **Общая рекурсивная `jsonValueSchema`** для payload в `log-event`/`projected-event` — `z.record(z.string(), z.unknown())` не принуждает структурно REQ-CTR-002.
- Косметика: breadcrumb в `schema.prisma` о рукописном CHECK; ассерт ортогональности soft-delete только для CANCELLED.

## Осталось недоделанным

- **Push** (`main` на 16+ коммитов впереди `origin/main`) — решение владельца.
- **Выбор следующего среза** (OAuth либо иной) — решение владельца, см. «Следующее действие».
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.
- **CLAUDE.md несёт устаревший указатель точки входа** (`docs/sessions/handoff-to-aidd-session.md` вместо `HANDOFF.md`) и развилку turbo/nx как нерешённую — AGENTS.md синхронизирован, CLAUDE.md не тронут (решение владельца).

## Session 2026-09-02 (срез исключения — закрытие: Task 9, мердж, LOC-снапшот)

### Что сделано

- **Task 9 (гейты):** полный конвейер `build → lint → typecheck → test → test:int → server e2e → boundary-check → guardrails` зелёный на ветке `feat/membership-exclusion` (Tasks 1–8 были закоммичены прежними сессиями).
- **Мердж в `main` `--no-ff`** (`c2e60da`) по выбору владельца (локальный мердж, не PR); повторный прогон всех гейтов на слитом результате — зелёный. Ветка `feat/membership-exclusion` удалена.
- **LOC-снапшот** по методике `docs/stats/loc-snapshots.md` (`c9fbaa8`): 9 731 строки кода (+797), core 6 772 / sdk 1 831 / server 1 067; тесты/прод 1.39; миграций 8 (первая схемная за три среза — `Membership.deletedAt/joinIp` + `Exclusion`).

### Коммиты этой сессии

- `c2e60da` Merge branch 'feat/membership-exclusion' — срез исключения участников (REQ-SEC-003, REQ-ID-006 ч.3, REQ-ID-011/013, REQ-SEC-006)
- `c9fbaa8` docs(stats): LOC-снапшот после мерджа membership-exclusion
- (+ handoff-коммит этой правки)

### Локальное состояние (не в git)

- Docker Desktop запущен (нужен для int/e2e); чужие контейнеры `lt-pg` (5432) и `lt-pg-sdd` (55432) не тронуты.
- Леджера исполнения среза исключения в `.superpowers/sdd/` нет (только срезы до realtime) — история исполнения: план `docs/sessions/2026-08-18-membership-exclusion-implementation-plan.md` + `git log 89d887f..c2e60da`.
- Side-effects на внешние системы: нет (push не выполнялся).

### Осталось недоделанным

- См. одноимённый раздел выше (push, выбор следующего среза, юрист, CLAUDE.md-указатель).
