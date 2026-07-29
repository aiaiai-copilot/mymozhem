# HANDOFF

**Date:** 2026-07-29 (вечер, батч 2 membership/guest-join)
**Branch:** `phase-1-membership-guest-join` (6 коммитов поверх `main`: батч 1 — `3279301` SDK-схемы, `e4d8b64` конфиг §4; батч 2 — `6ec1277` схема membership + код/политика, `46363d0` fix классификатора коллизии, `60ee3f6` createGuest + ORGANIZER-membership; `main` сам на 3 коммита впереди `origin/main`, push — решение владельца; untracked `AGENTS.md` — не сессионный, не трогать).

**Состояние фазы 1.** SDK contract core, сервис регистрации манифеста, Room lifecycle, Identity minimal seam, Lifecycle-эмит в лог и appSettings write path — завершены и слиты в `main`. Срез **Membership / guest-join** (REQ-ID-002/003/006/011/013) исполняется subagent-driven по плану `docs/sessions/2026-07-29-membership-guest-join-implementation-plan.md`, разбитому на 3 батча (решение владельца 2026-07-29, один батч на сессию): **батч 1 (Tasks 1–2) и батч 2 (Tasks 3–4) — COMPLETE**, ревью чистые (батч 2 — после одного fix-раунда на Task 3); батч 3 (Tasks 5–6 + финальное whole-branch ревью ветки) — в новой сессии. Этап продукта — MVP. Метод — AIDD / Specification-Driven.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. **`.superpowers/sdd/2026-07-29-membership-guest-join-implementation-plan/progress.md` — леджер текущего среза.** Tasks 1–4 COMPLETE, ревью чистые — не пере-диспатчить. Резюм: Task 5. (Старый леджер прежних срезов — `.superpowers/sdd/progress.md`.) Леджер не в git (`.superpowers/` игнорируется) — существует только на этой машине; `git clean -fdx` уничтожит.
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `docs/sessions/2026-07-23-appsettings-write-path-design.md` — образец свежего дизайна среза (§0 — решения владельца, §5 — post-lock re-read, §9 — швы).
6. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы (sdk-contract-core, app-registry, room-lifecycle, identity-minimal-seam, realtime-log-lifecycle-emit, appsettings-write-path, их дизайн-доки) читать только при разборе истории — их работа в коммитах.

## Следующее действие

**Батч 3 среза Membership / guest-join — Tasks 5–6 в новой сессии** (subagent-driven, режим тот же) **+ финальное whole-branch ревью ветки**: `JoinRateLimiter` + `MembershipService.join` с лимитами и единообразным отказом, затем экспорты/wiring приложения, полные гейты и живой boot с 6 миграциями. План: `docs/sessions/2026-07-29-membership-guest-join-implementation-plan.md` (controller-notes в шапке — обязательное чтение: depcruise не меняется, алфавит 31 символ, заявленная замена теста атомарности). Леджер резюма — см. пункт 2 выше. Интерфейсы, готовые для батча 3: `roomJoinPolicySchema`/`RoomJoinPolicy`, `displayNameSchema` (SDK); `APP_CONFIG`/`ConfigModule`/`AppConfig` (`3279301`/`e4d8b64`); Prisma-схема `membership` (модель `Membership`, enum `MemberRole`, частичный индекс `Membership_single_organizer_key`), `Room.code`/`Room.joinPolicy`, `Identity.displayName` (миграция `20260729164500_membership_guest_join`, commit `6ec1277`); `IdentityService.createGuest(displayName, tx?)`, `MembershipService.createOrganizerMembership(tx, roomId, identityId)`, `RoomService.create(organizerId, joinPolicy?)` — 5-аргументный конструктор (commit `60ee3f6`). Классификатор коллизии кода матчит P2010-обёртку (commit `46363d0`) — см. долгоживущие ограничения.

**Follow-up пакеты, подбираемые будущими планами явно:**

**Для следующего среза, трогающего configure/app-registry** (из финального ревью appSettings, ~15 строк суммарно):
- guard в `configure` на `settings === undefined || settings === null` → `AppSettingsInvalidError` (сейчас: permissive-схема + null даёт сырую P2011 от CHECK, а re-configure с `undefined` молча оставляет stale settings под новым пином; гейт активации ловит до эмита, но отказ нетипизирован);
- `ValidateFunction` импортировать из `ajv/dist/2020`, а не из `ajv` (type-only косметика);
- race-тест configure-vs-activate со второй версией манифеста (quiz@2) — сейчас обе стороны гонки пинят quiz@1, и ассерт «пин == строке» проходит тривиально;
- при появлении транспорта: зафиксировать в контрактных доках допущение «settings — не-null JSON value».

**Для первого реального identity-пишущего потока** (guest-join / OAuth), со среза identity — **бóльшая часть подобрана планом membership/guest-join** (presence-тест индекса с UNIQUE+колонкой, кросс-kind кейс, косметика harness'а и jest-конфига — Task 3 плана). Остаётся на транспортный срез:
- malformed non-UUID `organizerId` → сейчас сырой Postgres uuid-syntax error; маппинг в типизированную ошибку — на boundary-слое первого транспорта (REQ-SEC-006);

**Для среза event-commit (из дизайна lifecycle-эмита, §10):** подобрать отложенные тесты actorId≠null и payload-нейтральности гонки за seq.

**Для плана с auth/HTTP:** REST-поверхность + маппинг типизированных ошибок + actorId (швы дизайна appSettings §9). Все новые коды этого среза (`APP_MANIFEST_UNKNOWN`, `APP_SETTINGS_INVALID`, `ROOM_NOT_CONFIGURED`, `ROOM_SETTINGS_FROZEN`) — core-внутренние; `ROOM_SETTINGS_FROZEN` намеренно совпадает строкой с зарезервированным кодом SDK-контракта (маппинг 1:1).

**Для плана realtime read:** проекции appSettings (ядро проецирует конфиг наравне с состоянием, ADR-008).

**Forward-обязательство** (не забыть при первом же выходе наружу): первый потребитель, отдающий `ContractError`/доменную ошибку по HTTP/Socket.io, обязан идти через типизированный код без стектрейса, не `err.message` (REQ-SEC-006).

## Два гейта над фазами

1. **Юрист** — до первого события с посторонними или призами. Список вопросов готов (`docs/legal/questions-for-lawyer.md`). Блокирует старт работы с реальными PII, не блокирует реализацию.
2. **Первое живое событие** — до тяжёлых вложений в фазу 3 (rewards/лотерея).

## Долгоживущие ограничения, введённые срезами

- **Замороженные миграции:** `20260718061612_room_lifecycle`, `20260722151900_identity_seam`, `20260722153952_room_organizer_fk`, `20260722180147_realtime_log_event`, `20260723090841_room_app_config`, `20260729164500_membership_guest_join`. Любое изменение — только новой миграцией.
- **Конвенция порядка блокировок:** advisory lock комнаты — всегда leaf-most; транзакция, захватившая его, не должна после этого писать в `room."Room"` (порядок безопасен: `transition` берёт row-lock до advisory lock, эмит — последним шагом; `commitCoreEvent` не трогает Room; `configure` advisory lock не берёт и цикла не создаёт — проверено финальным ревью appSettings).
- **Prisma 7.8 adapter-pg ловушка:** `$queryRaw` не десериализует `void`-возвращающие выражения (`pg_advisory_xact_lock`) — использовать `$executeRaw`. Учитывать при написании будущих планов.
- **Prisma 7.8 adapter-pg: форма ошибок raw-запросов.** Падающий `$queryRaw` оборачивается в `PrismaClientKnownRequestError` с кодом `P2010`; SQLSTATE сидит внутри message (``Raw query failed. Code: `23505`. Message: ...``) и в `meta.driverAdapterError.cause.originalCode`. Топ-левел `err.code` НИКОГДА не равен SQLSTATE — матчить как `code === 'P2010'` + подстроки в message (прецедент: `isRoomCodeCollision`, commit `46363d0`). Также: `$queryRaw` возвращает сырое DB-значение enum (`'guests'`), а не Prisma-имя из `@map` (`'GUESTS'`) — клиентский `@map` применяет только десериализация клиента; при `RETURNING *` из raw INSERT нужен re-read через клиент (`findUniqueOrThrow`), как в `insertRoom`.
- **Инвариант «change both or neither»:** предикат `kind = 'REGISTERED' AND deletedAt IS NULL` живёт в двух местах — частичный индекс `"Identity_registered_email_key"` (миграция identity_seam) и guarded INSERT в `RoomService.create`. Менять только вместе (design §7).
- **Хост-порт 5432 занят чужим контейнером `lt-pg`** (не проектным, не трогать). Authoring-контейнер миграций (`mm-migrate`, эфемерный) публиковать на свободный порт (в срезах использовались 55432/55433) и подставлять его в `DATABASE_URL`.
- **`prisma migrate dev` не всегда регенерирует клиент; явный `pnpm exec prisma generate` требует DATABASE_URL** и cwd = корень репозитория (обнаружение `prisma.config.ts`).
- **`packages/core/src/testing/postgres.testcontainer.ts` — переиспользуемый паттерн ядра.** Все будущие DB-тесты пойдут через него, поэтому его острые углы наследуются: он мутирует глобальный `process.env.DATABASE_URL` и не восстанавливает его (безопасно только при `maxWorkers: 1`), и требует cwd = корень репозитория для обнаружения `prisma.config.ts`.
- **Прогон интеграционной ланы поднимает контейнеры Postgres** (по одному на describe с `startTestDb`; ~8 с локально на файл, дольше на холодном CI-раннере). Docker Desktop должен быть запущен.
- **Jest CLI:** форма `pnpm --filter @mymozhem/core test:int -- -t "..."` миспарсится (`-t` становится testPathPattern) — рабочая форма без `--`: `test:int -t "..."`. В планах писать сразу правильно.

## Отложенные follow-up (не гейтят; полный список с обоснованиями — в леджере)

Самое ценное из накопленного:

- **`updateManyAndReturn` доступен на закреплённой Prisma 7.8.0** — схлопнет 3 запроса в 2 в обеих мутациях `RoomService` (transition/softDelete) и попутно уберёт дублирование хвоста `if (count===0) throw` + re-read. Проверено ревьюером, не гипотеза. **Осторожно:** `transition` — транзакция с побочным эмитом; применение updateManyAndReturn не должно разорвать атомарность «UPDATE + лог». После appSettings-среза в transition есть ещё и post-lock re-read — его роль (консистентный снимок пина) не спутать с рефакторингом. Аналогичный 2-запросный паттерн и в `configure` — тот же кандидат.
- **Нет гейта на дрейф миграций.** `prisma migrate diff --from-migrations` здесь непригоден: Prisma 7.8 требует `datasource.shadowDatabaseUrl` в `prisma.config.ts`, которого нет. Стоит завести настоящий гейт, пока миграций мало.
- **Общая рекурсивная `jsonValueSchema`** для payload в `log-event`/`projected-event` — `z.record(z.string(), z.unknown())` не принуждает структурно REQ-CTR-002.
- **Комментарий-шов о конвенции порядка блокировок в `event-log.service.ts`** (advisory lock — всегда leaf-most) — добавить в ближайшем срезе, трогающем файл, без отдельного коммита (appSettings-срез файл не трогал).
- Косметика: breadcrumb в `schema.prisma` о существовании рукописного CHECK; ассерт ортогональности soft-delete добавлен только для ветки CANCELLED (из трёх удаляемых статусов).

## Осталось недоделанным

- **Батч 3 плана membership/guest-join** (Tasks 5–6 + финальное whole-branch ревью ветки) — subagent-driven, новая сессия (см. «Следующее действие»).
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.

## Session 2026-07-29, вечер (батч 2 membership/guest-join: Tasks 3–4)

### Что сделано

- **Task 3 (миграция + код/политика в create)** — COMPLETE, commits `6ec1277` + fix `46363d0`. TDD RED→GREEN, unit 80/80, int 59/59, lint+typecheck чисто. Ревью: 1 Important (классификатор коллизии матчил несуществующую форму ошибки — топ-левел `23505` вместо P2010-обёртки) → fix-раунд 1: классификатор исправлен + 9 юнит-тестов на форму ошибки; re-review PASS. Отклонения, принятые ревью: re-read через `findUniqueOrThrow` (raw `$queryRaw` не применяет `@map` enum), ассерт `lower(email)` без кавычек (депарс Postgres), вынужденные правки двух старых raw-SQL тестов (NOT NULL `code`) и call-site в event-log.
- **Task 4 (createGuest + ORGANIZER-membership в транзакции create)** — COMPLETE, commit `60ee3f6`. TDD RED→GREEN, int 63/63, unit 80/80, lint+typecheck чисто. Ревью: spec ✅, Approved, 0 Critical/Important, 2 Minor (в roll-up леджера). Все 3 call-site `new RoomService(` обновлены под 5-аргументный конструктор.
- Миграция `20260729164500_membership_guest_join` применена и заморожена (рукописный частичный индекс `Membership_single_organizer_key`, REQ-DEV-006).
- Follow-up пакет identity-среза подобран планом (presence-апгрейд + кросс-kind тест) — исполнен в Task 3.
- Pre-flight конфликтов не было (скан чист ещё с батча 1); контроллер-ноутс плана сработали как заявлено.

### Коммиты этой сессии

- `6ec1277` feat(core): membership schema + room code & join policy in create (REQ-ID-013, REQ-ID-002, REQ-ID-011)
- `46363d0` fix(core): match P2010-wrapped 23505 in room code collision classifier (REQ-ID-013)
- `60ee3f6` feat(core): IdentityService.createGuest + organizer membership on room create (REQ-ID-003, REQ-ID-011)
- плюс handoff-коммит. Всё на ветке `phase-1-membership-guest-join`, не пушено (push — решение владельца).

### Локальное состояние (не в git)

- Docker Desktop запущен; `lt-pg` на 5432 нетронут; проектных контейнеров нет (`mm-migrate` удалён после authoring'а миграции).
- Untracked `AGENTS.md` в корне — не трогать.
- Леджер среза: `.superpowers/sdd/2026-07-29-membership-guest-join-implementation-plan/progress.md` — Tasks 1–4 COMPLETE с разборами ревью и fix-раунда; briefs/reports/диффы ревью рядом. `git clean -fdx` уничтожит.
- Внешних side-effects не было (ни push, ни прод-тестов).

### Осталось недоделанным

- Батч 3 (Tasks 5–6 + финальное ревью ветки) — новая сессия (см. «Следующее действие»).
- Юрист — гейт 1 открыт, действие вне агента.
