# HANDOFF

**Date:** 2026-07-30 (транспортный срез СЛИТ в `main` и запушен: merge `e28daec`; ветка `phase-1-transport-http-auth` удалена локально и на origin; фаза 1 продолжается выбором следующего среза)
**Branch:** `main` (в синхроне с `origin/main` после push `f4ec5a7..e28daec`; untracked `AGENTS.md` — не сессионный, не трогать).

**Состояние фазы 1.** SDK contract core, сервис регистрации манифеста, Room lifecycle, Identity minimal seam, Lifecycle-эмит в лог, appSettings write path, Membership/guest-join, **транспортный auth/HTTP** — реализованы и ВСЕ слиты в `main` (транспорт — merge-коммитом `e28daec`, 44 файла, +1626 строк; тесты на результате мерджа зелёные). Транспорт исполнялся subagent-driven батчами: 12/12 задач, финальное whole-branch ревью MERGE-READY, reuse-логирование добавлено (`519fd8a`). Леджер исполнения: `.superpowers/sdd/2026-07-30-transport-http-auth-implementation-plan/progress.md` (не в git, существует только на этой машине). Этап продукта — MVP. Метод — AIDD / Specification-Driven.

**Что построил срез:** `POST /rooms/join` + `POST /auth/refresh`; access JWT HS256 + httpOnly refresh-cookie с ротацией семейств и reuse-detection (`identity."Session"`, REQ-ID-007/008/016); единый фильтр ошибок, наружу ровно `{code}` (REQ-SEC-006); join/refresh rate-limit с lazy sweep (REQ-ID-006, REQ-SEC-007); helmet/CORS-allowlist/trustProxy из конфига (REQ-SEC-008); fail-closed JWT_SECRET (REQ-SEC-002); SDK-контракт 1.1.0; seed-скрипт `pnpm create-room` (REQ-SEC-001). Гейты: build/lint/typecheck/test(320)/test:int(88)/boundary-check/guardrails — зелёные; docker smoke: 403 ROOM_JOIN_DENIED на join с неверным кодом.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. `docs/sessions/2026-07-30-transport-http-auth-design.md` + `2026-07-30-transport-http-auth-implementation-plan.md` — последний исполненный срез (для разбора истории и швов к следующим срезам: §10 дизайна — швы к realtime handshake и OAuth). §0 — решения владельца, §11 — принятые компромиссы.
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `.superpowers/sdd/2026-07-29-membership-guest-join-implementation-plan/progress.md` и `.superpowers/sdd/2026-07-30-transport-http-auth-implementation-plan/progress.md` — леджеры завершённых срезов (не переисполнять). Леджеры не в git (`.superpowers/` игнорируется) — существуют только на этой машине; `git clean -fdx` уничтожит. Новый леджер следующего среза создаётся рядом по той же конвенции.
6. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы прежних срезов (sdk-contract-core, app-registry, room-lifecycle, identity-minimal-seam, realtime-log-lifecycle-emit, appsettings-write-path, membership-guest-join, transport-http-auth) читать только при разборе истории — их работа в коммитах.

## Следующее действие

**Выбор следующего среза фазы 1** (brainstorm → дизайн → план по конвейеру superpowers). Мердж транспортного среза завершён; HANDOFF переписан.

**LOC-базлайн:** `docs/stats/loc-snapshots.md` — после каждого слитого среза дописывать строку снапшота по зафиксированной там методике (сравнение роста между фазами).

**Кандидаты на следующий срез** (из follow-up пакетов ниже): realtime read/handshake (берёт готовые `TokenService.verifyAccessToken` + claims-формат — самый прямой шов, дизайн §10), event-commit (отложенные тесты actorId≠null и payload-нейтральности гонки за seq), OAuth-срез (`POST /rooms` + Google-флоу, REQ-ID-015/009).

**Остаточные риски, принятые мерджем (из финального ревью):**
- Строгая ротация refresh: потерянный ответ → безобидный ретрай старого токена → ревок семейства (REQ-ID-007 как спроектировано, без grace-окна; дизайн §4 принял strict detection).
- Access-токены живут ≤15 мин после терминации комнаты/исключения (принятый компромисс дизайна §11; апгрейд — revocation по `sid`).
- `/health/ready` 503 теперь отдаёт `{code:'INTERNAL_ERROR'}` вместо `{status,db}` (статус неизменен, пробы не затронуты) — следствие глобального фильтра.
- **Для OAuth-среза:** `TokenService.sessionExpiry()` применяет guest-cap `min(REFRESH,GUEST_TTL)` безусловно — REGISTERED-ротация не должна его наследовать (token.service.ts, design §10).
- **Для web-client-среза:** CORS без `credentials: true` + SameSite=Strict — клиент с другого origin не сможет использовать refresh-куку (сейчас корректно для same-origin).

**Принятые при исполнении отклонения от плана (все прошли ревью, зафиксированы в леджере):**
- `packages/core` без fastify-зависимости → структурные типы `RequestLike`/`ReplyLike` (`transport/http.types.ts`) вместо `FastifyReply/FastifyRequest` (чистота границы, ADR-002-friendly).
- HttpException сохраняет свой статус (404→`REQUEST_INVALID`, 503→`INTERNAL_ERROR`) — плановая таблица важнее код-скетча.
- Race-тест rotate: alive-count по `{revokedAt: null, replacedById: null}` (design §4 метит ротированные через `replacedById`).
- Терминальная комната в тестах — через `cancel` (DRAFT→CANCELLED); DRAFT→COMPLETED нелегален.
- `NODE_OPTIONS=--experimental-vm-modules` в test-скрипте apps/server (ESM-only `cookie@2` под jest 29 CJS — верифицировано, изолировано).
- Seed-скрипт импортирует core через `dist/*.js` subpath'ы (баррел тянет testcontainers — см. ограничения ниже).
- **Финальное ревью (fable, whole-branch):** MERGE-READY. Единственный Important — reuse-detection не логировался, хотя дизайн §11 обосновывает коллапс кодов серверным логом — по решению владельца исправлен до мерджа (`519fd8a`: `logger.warn` на AuthError-ветке, wire неизменён, токен-материала в логах нет). Все deferred-миноры леджера оттриажены: fix-before-merge нет.

Опыт батча 1 для следующих сессий:
- Имплементеры дважды пытались писать report/brief в `~/.superpowers` вместо репозиторного `.superpowers` — после каждого имплементера проверять наличие report-файла в workspace ДО диспатча ревьюера (промпт даёт абсолютный путь, но проверка дешевле резюма агента).
- Плановый jest-фильтр Task 3 `-t "Session schema"` матчит ноль тестов (кавычка в имени describe) — писать в диспатчах рабочую форму фильтра, ловушка «0 tests, exit 0» реальна.
- Docker Desktop нужен уже с Task 3 (миграция) и далее (int-ланы, e2e, smoke).

Перед стартом батча — Docker Desktop должен быть запущен (int/e2e/smoke поднимают контейнеры Postgres).

**Ключевые решения владельца, зашитые в дизайн (§0) — не переоткрывать при исполнении:**
- Google OAuth НЕ в срезе; комнаты к первому событию — seed-скриптом через core-сервисы (Task 11), служебный REGISTERED-организатор без логина.
- Эндпоинты только `POST /rooms/join` + `POST /auth/refresh`; `POST /rooms` — с OAuth-срезом.
- Транспорт живёт в `packages/core/src/transport/` (вариант A); `apps/server` — чистая композиция.
- Единый wire-код `RATE_LIMITED` (core-код `JOIN_RATE_LIMITED` маппится в фильтре); единый `SESSION_INVALID` для всех отказов refresh.
- Все три parked-minor'а в скоупе: real-IP (TRUST_PROXY), eviction лимитера, uuid-сырьё → `REQUEST_INVALID`.

**Follow-up пакеты, подбираемые будущими планами явно:**

**Для следующего среза, трогающего configure/app-registry** (из финального ревью appSettings, ~15 строк суммарно):
- guard в `configure` на `settings === undefined || settings === null` → `AppSettingsInvalidError` (сейчас: permissive-схема + null даёт сырую P2011 от CHECK, а re-configure с `undefined` молча оставляет stale settings под новым пином; гейт активации ловит до эмита, но отказ нетипизирован);
- `ValidateFunction` импортировать из `ajv/dist/2020`, а не из `ajv` (type-only косметика);
- race-тест configure-vs-activate со второй версией манифеста (quiz@2) — сейчас обе стороны гонки пинят quiz@1, и ассерт «пин == строке» проходит тривиально;
- при появлении транспорта: зафиксировать в контрактных доках допущение «settings — не-null JSON value». (Транспорт появляется в текущем срезе — пункт можно подобрать при HTTP для configure.)

**Для среза event-commit (из дизайна lifecycle-эмита, §10):** подобрать отложенные тесты actorId≠null и payload-нейтральности гонки за seq.

**Из membership/guest-join финального ревью — ОСТАЁТСЯ после транспортного среза** (три parked-minor'а подобраны планом: eviction лимитера, real-IP, uuid-маппинг; health e2e placeholder — Task 9 плана):
- гонка soft-delete/status-flip между проверкой и insert в `MembershipService.join` — принятый класс гонки (design fork (б)); acceptance в леджере; fail-safe (сиротская membership-строка безвредна);
- JSDoc на `RoomService.create`: словарь политики lowercase-in (`'registered'`) / Prisma-name-out (`'REGISTERED'`).

**Для плана realtime read / handshake:** проекции appSettings (ядро проецирует конфиг наравне с состоянием, ADR-008); handshake берёт готовые `TokenService.verifyAccessToken` и формат claims (`sub`, `sid`, `kind`, `roomId?`) — шов зафиксирован в дизайне §10.

**Для OAuth-среза:** `POST /rooms` + Google-флоу (REQ-ID-015/009); REGISTERED-ветка `TokenService` без roomId-scope; таблица сессий и фильтр уже будут на месте (швы дизайна §10).

## Два гейта над фазами

1. **Юрист** — до первого события с посторонними или призами. Список вопросов готов (`docs/legal/questions-for-lawyer.md`). Блокирует старт работы с реальными PII, не блокирует реализацию.
2. **Первое живое событие** — до тяжёлых вложений в фазу 3 (rewards/лотерея).

## Долгоживущие ограничения, введённые срезами

- **Замороженные миграции:** `20260718061612_room_lifecycle`, `20260722151900_identity_seam`, `20260722153952_room_organizer_fk`, `20260722180147_realtime_log_event`, `20260723090841_room_app_config`, `20260729164500_membership_guest_join`, `20260730101037_auth_sessions`. Любое изменение — только новой миграцией.
- **Prod-баррел core тянет testcontainers в require-time** (design §9 — осознанное расширение ради e2e). Безопасно, пока Dockerfile тащит полные `node_modules` в runtime-стейдж; упадёт при pruning devDependencies. Follow-up-кандидат: вынести testing в отдельный entry point (`@mymozhem/core/testing`); не давать workaround с dist-subpath-импортами (create-room.mjs) стать постоянным.
- **`NODE_OPTIONS=--experimental-vm-modules` зашит в test-скрипт apps/server** — `@fastify/cookie@11` динамически импортирует ESM-only `cookie@2`, что ломает jest 29 CJS. Изолирован в test-скрипте. Триггеры пересмотра: jest 30 или `@fastify/cookie` на `require(ESM)` (Node 24).
- **Refresh-кука `Secure` при `NODE_ENV=production`** — compose-смоук по plain HTTP не сможет round-trip куки cookie-jar клиентом; ассертить `Set-Cookie`-заголовок.
- **Конвенция порядка блокировок:** advisory lock комнаты — всегда leaf-most; транзакция, захватившая его, не должна после этого писать в `room."Room"` (порядок безопасен: `transition` берёт row-lock до advisory lock, эмит — последним шагом; `commitCoreEvent` не трогает Room; `configure` advisory lock не берёт и цикла не создаёт — проверено финальным ревью appSettings).
- **Prisma 7.8 adapter-pg ловушка:** `$queryRaw` не десериализует `void`-возвращающие выражения (`pg_advisory_xact_lock`) — использовать `$executeRaw`. Учитывать при написании будущих планов.
- **Prisma 7.8 adapter-pg: форма ошибок raw-запросов.** Падающий `$queryRaw` оборачивается в `PrismaClientKnownRequestError` с кодом `P2010`; SQLSTATE сидит внутри message (``Raw query failed. Code: `23505`. Message: ...``) и в `meta.driverAdapterError.cause.originalCode`. Топ-левел `err.code` НИКОГДА не равен SQLSTATE — матчить как `code === 'P2010'` + подстроки в message (прецедент: `isRoomCodeCollision`, commit `46363d0`). Также: `$queryRaw` возвращает сырое DB-значение enum (`'guests'`), а не Prisma-имя из `@map` (`'GUESTS'`) — клиентский `@map` применяет только десериализация клиента; при `RETURNING *` из raw INSERT нужен re-read через клиент (`findUniqueOrThrow`), как в `insertRoom`.
- **Инвариант «change both or neither»:** предикат `kind = 'REGISTERED' AND deletedAt IS NULL` живёт в двух местах — частичный индекс `"Identity_registered_email_key"` (миграция identity_seam) и guarded INSERT в `RoomService.create`. Менять только вместе (design §7).
- **Хост-порт 5432 занят чужим контейнером `lt-pg`** (не проектным, не трогать). Authoring-контейнер миграций (`mm-migrate`, эфемерный) публиковать на свободный порт (в срезах использовались 55432/55433; в плане транспорта — 55434/55435) и подставлять его в `DATABASE_URL`.
- **`prisma migrate dev` не всегда регенерирует клиент; явный `pnpm exec prisma generate` требует DATABASE_URL** и cwd = корень репозитория (обнаружение `prisma.config.ts`).
- **`packages/core/src/testing/postgres.testcontainer.ts` — переиспользуемый паттерн ядра.** Все будущие DB-тесты пойдут через него, поэтому его острые углы наследуются: он мутирует глобальный `process.env.DATABASE_URL` и не восстанавливает его (безопасно только при `maxWorkers: 1`), и требует cwd = корень репозитория для обнаружения `prisma.config.ts`. Транспортный срез экспортирует его через barrel core для e2e в apps/server (осознанное решение, дизайн §9).
- **Прогон интеграционной ланы поднимает контейнеры Postgres** (по одному на describe с `startTestDb`; ~8 с локально на файл, дольше на холодном CI-раннере). Docker Desktop должен быть запущен.
- **Jest CLI:** форма `pnpm --filter @mymozhem/core test:int -- -t "..."` миспарсится (`-t` становится testPathPattern) — рабочая форма без `--`: `test:int -t "..."`. В планах писать сразу правильно.

## Отложенные follow-up (не гейтят; полный список с обоснованиями — в леджере)

Самое ценное из накопленного:

- **Вынести testing-экспорты из prod-баррела core** в отдельный entry point (см. ограничение выше) — при этом починить и `create-room.mjs` обратно на баррел (его dist-subpath-импорты молча сломаются при появлении `exports` в core).
- **`create-room.mjs`: findFirst по точному `email`, а индекс — по `lower(email)`** — при кейс-варианте email будет сырая unique-violation вместо reuse (edge case seed-скрипта; `mode: 'insensitive'` или комментарий).

- **`updateManyAndReturn` доступен на закреплённой Prisma 7.8.0** — схлопнет 3 запроса в 2 в обеих мутациях `RoomService` (transition/softDelete) и попутно уберёт дублирование хвоста `if (count===0) throw` + re-read. Проверено ревьюером, не гипотеза. **Осторожно:** `transition` — транзакция с побочным эмитом; применение updateManyAndReturn не должно разорвать атомарность «UPDATE + лог». После appSettings-среза в transition есть ещё и post-lock re-read — его роль (консистентный снимок пина) не спутать с рефакторингом. Аналогичный 2-запросный паттерн и в `configure` — тот же кандидат.
- **Нет гейта на дрейф миграций.** `prisma migrate diff --from-migrations` здесь непригоден: Prisma 7.8 требует `datasource.shadowDatabaseUrl` в `prisma.config.ts`, которого нет. Стоит завести настоящий гейт, пока миграций мало.
- **Общая рекурсивная `jsonValueSchema`** для payload в `log-event`/`projected-event` — `z.record(z.string(), z.unknown())` не принуждает структурно REQ-CTR-002.
- **Комментарий-шов о конвенции порядка блокировок в `event-log.service.ts`** (advisory lock — всегда leaf-most) — добавить в ближайшем срезе, трогающем файл, без отдельного коммита (appSettings-срез файл не трогал).
- Косметика: breadcrumb в `schema.prisma` о существовании рукописного CHECK; ассерт ортогональности soft-delete добавлен только для ветки CANCELLED (из трёх удаляемых статусов).

## Осталось недоделанным

- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.
- **Судьба untracked `AGENTS.md`** в корне — вопрос владельцу открыт.
- **Следующий срез фазы 1 не выбран** — кандидаты выше.

## Session 2026-07-30 (мердж транспортного среза)

### Что сделано

- По решению владельца: полный прогон гейтов на ветке (unit 5 пакетов, int 88/88, boundary-check, guardrails — зелёные) → мердж `phase-1-transport-http-auth` в `main` merge-коммитом `e28daec` (--no-ff, 44 файла, +1626 строк) → тесты на результате мерджа зелёные → ветка удалена локально и на origin → `main` запушен (`f4ec5a7..e28daec`, 19 коммитов).
- HANDOFF переписан под состояние «срез слит, следующий срез не выбран».

### Коммиты этой сессии

- `e28daec` merge(core): transport auth/HTTP slice — join+refresh, token contour, REQ-SEC-006 filter (12/12 tasks, final review MERGE-READY)
- (+ handoff-коммит этой правки)

### Локальное состояние (не в git)

- Docker Desktop запущен (нужен для int/e2e). `lt-pg` на 5432 нетронут.
- SDD-леджер транспортного среза: `.superpowers/sdd/2026-07-30-transport-http-auth-implementation-plan/progress.md` — на месте; `git clean -fdx` уничтожит.
- Untracked `AGENTS.md` — вопрос владельцу открыт.
- Внешние side-effects: `git push origin main` (по явному решению владельца) + удаление удалённой ветки среза. Никаких прод-тестов и изменяющих действий наружу.

### Осталось недоделанным

- Выбор и старт следующего среза фазы 1 (realtime read/handshake | event-commit | OAuth).
- Юрист — гейт 1 открыт, действие вне агента.
