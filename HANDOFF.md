# HANDOFF

**Date:** 2026-07-29 (вечер, батч 1 membership/guest-join)
**Branch:** `phase-1-membership-guest-join` (2 коммита поверх `main`: `3279301` SDK-схемы, `e4d8b64` конфиг §4; `main` сам на 3 коммита впереди `origin/main`, push — решение владельца; untracked `AGENTS.md` — не сессионный, не трогать).

**Состояние фазы 1.** SDK contract core, сервис регистрации манифеста, Room lifecycle, Identity minimal seam, Lifecycle-эмит в лог и appSettings write path — завершены и слиты в `main`. Срез **Membership / guest-join** (REQ-ID-002/003/006/011/013) исполняется subagent-driven по плану `docs/sessions/2026-07-29-membership-guest-join-implementation-plan.md`, разбитому на 3 батча (решение владельца 2026-07-29, один батч на сессию): **батч 1 (Tasks 1–2) — COMPLETE** в этой сессии, ревью чистые; батчи 2–3 — в новых сессиях. Этап продукта — MVP. Метод — AIDD / Specification-Driven.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. **`.superpowers/sdd/2026-07-29-membership-guest-join-implementation-plan/progress.md` — леджер текущего среза.** Tasks 1–2 COMPLETE, ревью чистые — не пере-диспатчить. Резюм: Task 3. (Старый леджер прежних срезов — `.superpowers/sdd/progress.md`.) Леджер не в git (`.superpowers/` игнорируется) — существует только на этой машине; `git clean -fdx` уничтожит.
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `docs/sessions/2026-07-23-appsettings-write-path-design.md` — образец свежего дизайна среза (§0 — решения владельца, §5 — post-lock re-read, §9 — швы).
6. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы (sdk-contract-core, app-registry, room-lifecycle, identity-minimal-seam, realtime-log-lifecycle-emit, appsettings-write-path, их дизайн-доки) читать только при разборе истории — их работа в коммитах.

## Следующее действие

**Батч 2 среза Membership / guest-join — Tasks 3–4 в новой сессии** (subagent-driven, режим тот же): миграция `membership_guest_join` + код комнаты/политика в `RoomService.create` + `IdentityService.createGuest` + ORGANIZER-membership в транзакции. План: `docs/sessions/2026-07-29-membership-guest-join-implementation-plan.md` (controller-notes в шапке — обязательное чтение: depcruise не меняется, алфавит 31 символ, заявленная замена теста атомарности, нетестируемая коллизия кода; authoring-порт миграций — 55434). Леджер резюма — см. пункт 2 выше. Интерфейсы, готовые для батча 2: `roomJoinPolicySchema`/`RoomJoinPolicy`, `displayNameSchema` (SDK, commit `3279301`); `APP_CONFIG`/`ConfigModule`/`AppConfig` с `ROOM_CODE_MIN_LEN`/`ROOM_PARTICIPANT_LIMIT`/`JOIN_RATE_LIMIT_IP` (commit `e4d8b64`).

**Батч 3 (новая сессия после батча 2):** Tasks 5–6 (join + лимиты + wiring + полные гейты + живой boot) + финальное whole-branch ревью ветки.

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

- **Замороженные миграции:** `20260718061612_room_lifecycle`, `20260722151900_identity_seam`, `20260722153952_room_organizer_fk`, `20260722180147_realtime_log_event`, `20260723090841_room_app_config`. Любое изменение — только новой миграцией.
- **Конвенция порядка блокировок:** advisory lock комнаты — всегда leaf-most; транзакция, захватившая его, не должна после этого писать в `room."Room"` (порядок безопасен: `transition` берёт row-lock до advisory lock, эмит — последним шагом; `commitCoreEvent` не трогает Room; `configure` advisory lock не берёт и цикла не создаёт — проверено финальным ревью appSettings).
- **Prisma 7.8 adapter-pg ловушка:** `$queryRaw` не десериализует `void`-возвращающие выражения (`pg_advisory_xact_lock`) — использовать `$executeRaw`. Учитывать при написании будущих планов.
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

- **Батчи 2–3 плана membership/guest-join** (Tasks 3–4, затем 5–6 + финальное ревью) — subagent-driven, каждый в новой сессии (см. «Следующее действие»).
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.

## Session 2026-07-29, вечер (батч 1 membership/guest-join: Tasks 1–2)

### Что сделано

- Разрез плана на 3 батча подтверждён владельцем (один батч на сессию, как в срезе sdk-contract-core): 1–2 / 3–4 / 5–6+финальное ревью. Зафиксирован в леджере среза.
- Ветка `phase-1-membership-guest-join` от `a6d53b8`; baseline зелёный (unit-ланы всех пакетов, Docker поднят).
- **Task 1 (SDK: roomJoinPolicy + displayName)** — COMPLETE, commit `3279301`. TDD RED→GREEN, 182/182 (162+20), lint+typecheck чисто. Ревью: spec ✅, Approved, 0 Critical/Important, 1 Minor (в roll-up леджера).
- **Task 2 (конфиг §4 + ConfigModule)** — COMPLETE, commit `e4d8b64`. TDD RED→GREEN, 68/68 core (10/10 loadConfig describe), lint+typecheck чисто. Ревью: spec ✅, Approved, 0 находок; grep подтвердил отсутствие незапрошенных потребителей ConfigModule.
- Pre-flight скан плана чист (конфликтов задач и план-против-рубрики нет; якоря сверены с кодом — записано в леджере).

### Коммиты этой сессии

- `3279301` feat(sdk): room join policy + displayName contract schemas (REQ-ID-002, REQ-ID-003)
- `e4d8b64` feat(core): §4 join/code/participant config params + ConfigModule (REQ-OPS-003)
- плюс handoff-коммит. Всё на ветке `phase-1-membership-guest-join`, не пушено (push — решение владельца).

### Локальное состояние (не в git)

- Docker Desktop запущен; `lt-pg` на 5432 нетронут; проектных контейнеров нет.
- Untracked `AGENTS.md` в корне — не трогать.
- Леджер среза: `.superpowers/sdd/2026-07-29-membership-guest-join-implementation-plan/progress.md` — Tasks 1–2 COMPLETE с разборами ревью; briefs/reports/диффы ревью рядом. `git clean -fdx` уничтожит.
- Внешних side-effects не было (ни push, ни прод-тестов).

### Осталось недоделанным

- Батч 2 (Tasks 3–4) — новая сессия (см. «Следующее действие»): миграция, код/политика в create, createGuest, ORGANIZER-membership.
- Батч 3 (Tasks 5–6 + финальное ревью ветки) — новая сессия после батча 2.
- Юрист — гейт 1 открыт, действие вне агента.

## Session 2026-07-29 (дизайн + план среза membership/guest-join)

### Что сделано

- Выбран следующий срез фазы 1 (решение владельца): **Membership / guest-join** — код комнаты, политика входа, членство, лимиты входа.
- Дизайн пройден через superpowers:brainstorming по секциям, одобрен: `docs/sessions/2026-07-29-membership-guest-join-design.md`. Решения владельца (§1 дизайна): объём «join + лимиты» (kick и TTL — отдельные срезы); `displayName` на Identity; ORGANIZER-membership при create; rate-limit in-memory; `ROOM_PARTICIPANT_LIMIT_REACHED` отдельным кодом; гонка count-then-insert на лимите принята.
- План написан через superpowers:writing-plans, 6 задач: `docs/sessions/2026-07-29-membership-guest-join-implementation-plan.md` (controller-notes в шапке — depcruise не меняется, алфавит 31 символ, заявленная замена теста атомарности, нетестируемая коллизия кода).
- Режим исполнения: **subagent-driven в новой сессии** (решение владельца) — эта сессия код не писала.

### Коммиты этой сессии

- `be62c90` docs(sessions): membership/guest-join slice design (REQ-ID-002/003/006/011/013)
- `9ff5ac0` docs(sessions): membership/guest-join implementation plan
- плюс этот handoff-коммит; все три впереди `origin/main`, push — решение владельца.

### Локальное состояние (не в git)

- Docker Desktop запущен; `lt-pg` на 5432 нетронут; проектных контейнеров нет.
- Untracked `AGENTS.md` в корне — не создан этой сессией, содержимое не проверялось, не трогать.
- `.superpowers/sdd/` — леджер (`progress.md`) прежних срезов; нового раздела под membership/guest-join пока нет — заведёт исполняющая сессия. Не отслеживается git; `git clean -fdx` уничтожит.
- Внешних side-effects не было (ни push, ни прод-тестов).

### Осталось недоделанным

- Исполнение плана membership/guest-join — subagent-driven, новая сессия (см. «Следующее действие»).
- После исполнения: код-срезы из follow-up пакетов (configure/app-registry, event-commit) остаются на будущие планы.
- Юрист — гейт 1 открыт, действие вне агента.
