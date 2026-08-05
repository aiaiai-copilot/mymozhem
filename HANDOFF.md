# HANDOFF

**Date:** 2026-08-06 (срез **realtime read/handshake** исполнен 9/9, финальное ревью clean после fix-волны, слит в `main` мерджем `f0e5e88`; **следующий срез НЕ выбран — решение владельца**; **push — решение владельца**)
**Branch:** `main` (на 8 коммитов впереди `origin/main`: 5 docs-коммитов прошлой сессии + merge `f0e5e88` + LOC-снапшот `be707cd` + handoff этой сессии; untracked `AGENTS.md` — не сессионный, не трогать, вопрос владельцу открыт).

**Состояние фазы 1.** SDK contract core, сервис регистрации манифеста, Room lifecycle, Identity minimal seam, Lifecycle-эмит в лог, appSettings write path, Membership/guest-join, транспортный auth/HTTP, event-commit, **realtime read/handshake (полный duplex)** — реализованы и слиты в `main`. Критерии выхода ф.1 по realtime (late-join replay, видимость по каналам realtime/replay, потолок reconnect/replay) подтверждены e2e на проводе. Леджеры исполнения срезов: `.superpowers/sdd/*/progress.md` (не в git, только на этой машине). Этап продукта — MVP. Метод — AIDD / Specification-Driven.

**Что построил срез (realtime read/handshake, контракт SDK 1.1.0 → 1.2.0):** полный duplex-транспорт ядра — handshake по access JWT (per-identity потолок reconnect REQ-RT-015 в объёме v1.3, отказы SESSION_INVALID/RATE_LIMITED), subscribe с replay видимой проекции (события + appSettings; `projectedEventSchema` — единственная наружная форма, без seq/visibility/cursor, REQ-RT-011a), live-доставка через **EventOutbox на AsyncLocalStorage** (fail-closed: commit вне `outbox.run` бросает; откат недоставим структурно) + in-process RealtimeBus (одна реплика, REQ-OPS-005), publish app-событий в `commitAppEvent` (actorId только из claims, REQ-RT-009; core-неймспейс закрыт; дефолт visibility = потолок типа), `ProjectionService` — единственная точка построения видимости (REQ-CORE-005/008), таблица маппинга core→contract кодов (compile-time exhaustive; `EVENT_EMIT_RATE_LIMITED → EVENT_RATE_LIMITED`, новый код `ACTOR_NOT_MEMBER`), `SubscriptionRegistry` + hook `revokeRoomAccess` (REQ-SEC-003; вызывающего ждёт срез исключения), Socket.io изолирован в `packages/core/src/realtime` (REQ-RT-006). Гейты на мердже: build/lint/typecheck/test/test:int/e2e 24/boundary-check/guardrails — зелёные.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. Этот файл целиком.
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `.superpowers/sdd/2026-08-05-realtime-read-handshake-implementation-plan/progress.md` — леджер последнего среза (санкционированные отклонения, deferred-миноры, adjudication); леджеры прежних срезов рядом. Не в git (`.superpowers/` игнорируется) — существуют только на этой машине; `git clean -fdx` уничтожит.
6. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы и дизайны прежних срезов (включая realtime: `docs/sessions/2026-08-05-realtime-read-handshake-{design,implementation-plan}.md`) читать при разборе истории — их работа в коммитах. Состояние на конец прошлой сессии: `git show 3d7de83:HANDOFF.md`.

## Следующее действие

**Выбор следующего среза — решение владельца** (как зафиксировано прошлой сессией):
- **OAuth-срез** — `POST /rooms` + Google-флоу (REQ-ID-015/009); REGISTERED-ветка `TokenService` без roomId-scope; швы дизайна транспорта §10 на месте. См. также follow-up ниже про `sessionExpiry()` guest-cap.
- **Срез исключения** — membership + вызов `RealtimeGateway.revokeRoomAccess` (hook готов и e2e-проверен) — закроет критерий ф.1 «немедленный отзыв подписки» целиком; там же мягкое удаление membership (сейчас `findActiveMembership` гасит только на soft-delete комнаты — зафиксировано в его комментарии) и закрытие minor M-3 (stale registry window, см. риски).

После мерджа следующего среза: LOC-снапшот по методике `docs/stats/loc-snapshots.md`.

**Остаточные риски, принятые мерджем (realtime-срез):**
- **Duplicate-acceptance в subscribe** (осознанный trade-off дизайна §4): join каналов — ДО чтения лога, поэтому событие, закоммиченное между join и чтением, придёт и live, и в snapshot. Клиент без seq/cursor (REQ-RT-011a) дедуплицировать не может — принято для MVP; ссылка для фазовой работы над курсором (ф.4).
- **Deferred-миноры финального ревью (ride, триаж «не гейтят»):** M-2 — мёртвая инжекция `config` в RealtimeGateway (убрать при следующем касании); M-3 — stale registry entry при disconnect внутри subscribe (bounded, self-healing; закрыть в срезе исключения, где когерентность реестра load-bearing); M-4 — cross-socket timing в live-visibility e2e (микроскопическое окно флейка; маркер на organizer-сокете сделает детерминированным); M-5 — `asLogEvent` fallback fail-open (`?? row.visibility`) — fail-closed throw при следующем расширении enum EventVisibility.
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
- Срез исключения ОБЯЗАН вызвать `RealtimeGateway.revokeRoomAccess(identityId, roomId)` (шов дизайна §9); реестр подписок и `socketsOf` готовы.
- MODERATOR сейчас → уровень `public` (amendment v1.3); если права вырастут — пересмотреть маппинг уровня в `handleSubscribe`.
- Курсор replay (REQ-RT-011б) и метаданные seq — фаза 4; наружная форма события курсор структурно исключает (strictObject), эволюция — аддитивная через minor-версию контракта.
- Per-event re-check членства в live-доставке не делается (решение §0) — при появлении исключения подписка рвётся через hook, не через фильтрацию.

**Follow-up пакеты, подбираемые будущими планами явно:**
- **Чистка invalid-uuid литералов** в старых int-спеках (см. опыт выше) + fail-closed в `asLogEvent` (M-5) + удаление мёртвой инжекции config (M-2) — пакет косметики realtime.
- **Для среза исключения:** M-3 (stale registry window), мягкое удаление membership, права эмита по ролям (SPECTATOR) — app-семантика, фаза 2.
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

- **Замороженные миграции:** `20260718061612_room_lifecycle`, `20260722151900_identity_seam`, `20260722153952_room_organizer_fk`, `20260722180147_realtime_log_event`, `20260723090841_room_app_config`, `20260729164500_membership_guest_join`, `20260730101037_auth_sessions`. Любое изменение — только новой миграцией. (Два последних среза схему не меняли.)
- **Socket.io граница:** серверный `socket.io` импортируется только из `packages/core/src/realtime` (REQ-RT-006, правило dependency-cruiser с якорем на пакет `socket.io/`); `socket.io-client` — только `apps/server/test` (devDep). Правило круизит и dist (CI build→boundary-check) — в pathNot есть dist-исключение, осознанное.
- **Fan-out realtime:** publish в RealtimeBus — строго после коммита транзакции (`EventOutbox.run`); исключения слушателей изолированы в `fanOut` gateway (не отклоняют `run`); commit вне `outbox.run` бросает `EventOutboxMissingContextError` (fail-closed); вложенный `run` запрещён.
- **Subscribe:** join каналов — ДО чтения лога (duplicate-acceptance, дизайн §4); гейты (schema/guest-scope/мульти-подписка/membership) — до join; catch-путь чистит запись реестра.
- **Конвенция lockfile/CI:** один lockfile (REQ-DEV-002); CI порядок build → boundary-check.
- **Prod-баррел core тянет testcontainers в require-time** (design §9 — осознанное расширение ради e2e). Безопасно, пока Dockerfile тащит полные `node_modules` в runtime-стейдж; упадёт при pruning devDependencies. Follow-up-кандидат: вынести testing в отдельный entry point (`@mymozhem/core/testing`); не давать workaround с dist-subpath-импортами (create-room.mjs) стать постоянным.
- **`NODE_OPTIONS=--experimental-vm-modules` зашит в test-скрипт apps/server** — `@fastify/cookie@11` динамически импортирует ESM-only `cookie@2`, что ломает jest 29 CJS. Изолирован в test-скрипте. Триггеры пересмотра: jest 30 или `@fastify/cookie` на `require(ESM)` (Node 24).
- **Refresh-кука `Secure` при `NODE_ENV=production`** — compose-смоук по plain HTTP не сможет round-trip куки cookie-jar клиентом; ассертить `Set-Cookie`-заголовок.
- **Конвенция порядка блокировок:** advisory lock комнаты — всегда leaf-most; транзакция, захватившая его, не должна после этого писать в `room."Room"`.
- **Prisma 7.8 adapter-pg ловушка:** `$queryRaw` не десериализует `void`-возвращающие выражения (`pg_advisory_xact_lock`) — использовать `$executeRaw`. Учитывать при написании будущих планов.
- **Prisma 7.8 adapter-pg: форма ошибок raw-запросов.** Падающий `$queryRaw` оборачивается в `PrismaClientKnownRequestError` с кодом `P2010`; SQLSTATE внутри message и `meta.driverAdapterError.cause.originalCode`. Матчить `code === 'P2010'` + подстроки (прецедент `isRoomCodeCollision`). Также: `$queryRaw` возвращает сырое DB-значение enum (`'public'`), а не Prisma-имя (`'PUBLIC'`) — для staged-событий нормализует `asLogEvent` (realtime-срез); при `RETURNING *` из raw INSERT — re-read через клиент (прецедент `insertRoom`) или явная нормализация.
- **Инвариант «change both or neither»:** предикат `kind = 'REGISTERED' AND deletedAt IS NULL` живёт в двух местах — частичный индекс `"Identity_registered_email_key"` и guarded INSERT в `RoomService.create`. Менять только вместе.
- **Хост-порт 5432 занят чужим контейнером `lt-pg`** (не проектным, не трогать). Authoring-контейнер миграций (`mm-migrate`, эфемерный) публиковать на свободный порт.
- **`prisma migrate dev` не всегда регенерирует клиент; явный `pnpm exec prisma generate` требует DATABASE_URL** и cwd = корень репозитория.
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

- **Выбор следующего среза** (OAuth vs исключение) — решение владельца (см. «Следующее действие»).
- **Push `main`** (8 коммитов впереди origin после handoff-коммита) — решение владельца.
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.
- **Судьба untracked `AGENTS.md`** в корне — вопрос владельцу открыт.

## Session 2026-08-06 (исполнение realtime read/handshake)

### Что сделано

- **Срез исполнен целиком: 9/9 задач subagent-driven, батчами по 3** (решение владельца прошлой сессии), на ветке `feat/realtime-read-handshake`, слит мерджем `--no-ff` `f0e5e88`. Ветка удалена.
- **По задачам:** (1) конфиг `RECONNECT_RATE_LIMIT_PER_MIN`; (2) SDK 1.2.0 wire-конверты + `ACTOR_NOT_MEMBER` (+необходимая правка exhaustive-спека кодов); (3) таблица маппинга; (4) ProjectionService; (5) EventOutbox+RealtimeBus+RoomService на runner (широчайшая: 13 файлов); (6) SubscriptionRegistry+findActiveMembership+токен; (7) RealtimeGateway+IoAdapter; (8) e2e socket.io-client 9 тестов на проводе; (9) гейты зелёные.
- **Финальное ревью (fable): WITH FIXES → clean.** I-1 (порядок subscribe lossy против дизайна §4) и M-1 (replay-видимость только unit-покрыта) исправлены fix-волной `3483503`, scoped re-review подтвердил.
- **2 e2e-вскрытых core-бага** исправлены в срезе (`2d4799a`): raw-enum staged-событий (ронял всю live-доставку), отдельный порт socket.io (затрагивал prod).
- Все ревью задач — clean с первого прохода; 6 санкционированных владельцем отклонений (список выше). Гейты на мердже и на слитом результате — зелёные.

### Коммиты этой сессии

- `7957449` feat(core): конфиг RECONNECT_RATE_LIMIT_PER_MIN
- `23cfa4d` feat(sdk): realtime wire-конверты + ACTOR_NOT_MEMBER, контракт 1.2.0
- `df47465` feat(core): таблица маппинга core→contract кодов
- `bf1f432` feat(core): ProjectionService
- `45083ee` feat(core): EventOutbox + RealtimeBus; RoomService.transition на runner
- `3f27ea6` feat(core): SubscriptionRegistry + findActiveMembership + токен лимитера
- `b6cd3b5` feat(core): RealtimeGateway + ConfigurableIoAdapter
- `2d4799a` fix(core): containment handleSubscribe, httpServer в io-adapter, нормализация visibility
- `1c28137` test(server): realtime e2e (+ boundary anchor)
- `3483503` fix(core): subscribe join до чтения лога + e2e replay-видимости
- `f0e5e88` merge(core): realtime read/handshake slice
- `be707cd` docs(stats): LOC snapshot (main @ f0e5e88)
- (+ handoff-коммит этой правки)

### Локальное состояние (не в git)

- Docker Desktop запущен (int/e2e поднимают контейнеры Postgres); `lt-pg` на 5432 нетронут.
- Леджер среза: `.superpowers/sdd/2026-08-05-realtime-read-handshake-implementation-plan/progress.md` + briefs/reports/review-пакеты рядом (только на этой машине).
- Untracked `AGENTS.md` — вопрос владельцу открыт.
- Внешних side-effects нет (push не делался, деплоя нет).

### Осталось недоделанным

- Выбор следующего среза (OAuth vs исключение) — решение владельца.
- Push `main` — решение владельца.
- Юрист — гейт 1 открыт, действие вне агента.
