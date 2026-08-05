# HANDOFF

**Date:** 2026-08-05 (срез **event-commit** исполнен целиком — 9/9 задач, финальный ревью clean после фикс-волны — и слит в `main`; **push — решение владельца**)
**Branch:** `main` (на 2 коммита впереди `origin/main`: LOC-снапшот + handoff этой сессии; untracked `AGENTS.md` — не сессионный, не трогать).

**Состояние фазы 1.** SDK contract core, сервис регистрации манифеста, Room lifecycle, Identity minimal seam, Lifecycle-эмит в лог, appSettings write path, Membership/guest-join, транспортный auth/HTTP, **event-commit** — реализованы и слиты в `main`. Леджеры исполнения срезов: `.superpowers/sdd/*/progress.md` (не в git, только на этой машине). Этап продукта — MVP. Метод — AIDD / Specification-Driven.

**Что построил срез (event-commit):** `EventLogService.commitAppEvent` — запись app-событий в лог ядра: commit-цепочка из 8 шагов до advisory lock (status-гейт ACTIVE = запечатывание REQ-RT-016; per-actor лимит попыток REQ-RT-014 в объёме v1.3; размер REQ-RT-012; реестр+схема REQ-CTR-008; потолок видимости REQ-CTR-009 через `isWithinCeiling`; membership-гейт; append через общий приватный `appendLocked`), плюс **post-lock перечитывание статуса** (TOCTOU-фикс финального ревью — санкционированное владельцем отступление от буквы дизайна §2 «все проверки до lock»; payload-нейтральность REQ-RT-007 сохранена). Конфиг `EVENT_EMIT_RATE_LIMIT_PER_MIN`/`MAX_EVENT_PAYLOAD_BYTES` (REQ-OPS-003); типизированные realtime-ошибки (7 кодов); event read-path в `AppRegistryService`; actorId в lifecycle-эмит через `transition` (REQ-RT-009, service-уровень); характеризующие тесты конкурентного seq и payload-нейтральности (критерий выхода ф.1). Гейты на мердже: build/lint/typecheck/test(330)/test:int(106)/boundary-check/guardrails — зелёные.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. **`docs/sessions/2026-08-03-event-commit-design.md` + `2026-08-04-event-commit-implementation-plan.md` — исполнены, читать только при разборе истории.** Работа в коммитах (`git log fc53f2d..0ae4608`). Живой фронт — выбор следующего среза (см. «Следующее действие»).
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `.superpowers/sdd/2026-07-29-membership-guest-join-implementation-plan/progress.md`, `.superpowers/sdd/2026-07-30-transport-http-auth-implementation-plan/progress.md`, `.superpowers/sdd/2026-08-04-event-commit-implementation-plan/progress.md` — леджеры завершённых срезов (не переисполнять). Леджеры не в git (`.superpowers/` игнорируется) — существуют только на этой машине; `git clean -fdx` уничтожит. Новый леджер следующего среза создаётся рядом по той же конвенции.
6. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы прежних срезов (sdk-contract-core, app-registry, room-lifecycle, identity-minimal-seam, realtime-log-lifecycle-emit, appsettings-write-path, membership-guest-join, transport-http-auth) читать только при разборе истории — их работа в коммитах.

## Следующее действие

**Выбор следующего среза — решение владельца.** Кандидаты (из follow-up пакетов ниже): realtime read/handshake (берёт готовые `commitAppEvent` + `TokenService.verifyAccessToken` + claims-формат — самый прямой шов; **требует заранее таблицы маппинга core→contract кодов ошибок** — решение владельца 2026-08-05, см. follow-up), OAuth-срез (`POST /rooms` + Google-флоу, REQ-ID-015/009).

**LOC-базлайн:** `docs/stats/loc-snapshots.md` — после каждого слитого среза дописывать строку снапшота по зафиксированной там методике (сравнение роста между фазами).

**Остаточные риски, принятые мерджем (из финального ревью):**
- Строгая ротация refresh: потерянный ответ → безобидный ретрай старого токена → ревок семейства (REQ-ID-007 как спроектировано, без grace-окна; дизайн §4 принял strict detection).
- Access-токены живут ≤15 мин после терминации комнаты/исключения (принятый компромисс дизайна §11; апгрейд — revocation по `sid`).
- `/health/ready` 503 теперь отдаёт `{code:'INTERNAL_ERROR'}` вместо `{status,db}` (статус неизменен, пробы не затронуты) — следствие глобального фильтра.
- **Для OAuth-среза:** `TokenService.sessionExpiry()` применяет guest-cap `min(REFRESH,GUEST_TTL)` безусловно — REGISTERED-ротация не должна его наследовать (token.service.ts, design §10).
- **Для web-client-среза:** CORS без `credentials: true` + SameSite=Strict — клиент с другого origin не сможет использовать refresh-куку (сейчас корректно для same-origin).

**Принятые при исполнении отклонения от плана (все прошли ревью, зафиксированы в леджере):**
- **TOCTOU-фикс (финальное ревью, решение владельца):** post-lock перечитывание статуса комнаты в `commitAppEvent` — санкционированное отступление от буквы дизайна §2 «все проверки ДО lock»; guard app-only (`commitCoreEvent` не тронут), детерминированный гоночный int-тест (pg_locks condition-poll) с fails-without-fix верификацией. Дух дизайна (payload-нейтральность) сохранён: перечитывание O(1), от размера payload не зависит.
- Safe-stringify helper: нестрингифицируемый payload (undefined/BigInt/circular) → типизированная `EVENT_PAYLOAD_INVALID` вместо сырого TypeError (порядок шагов цепочки не изменён).
- Косметика: unused-импорт `EventEmitRateLimitedError` убран из int-спеки в Task 5 (lint-гейт) и возвращён в Task 6; локаль `base` → `envBase` в config-спеке (тень от top-level).
- Транспортный срез — его отклонения и опыт батчей: `git show 2baf523:HANDOFF.md` (вырезано по принципу роста).

Опыт этой сессии для следующих:
- Имплементеры стабильно путают `~/.superpowers` с репозиторным `.superpowers` — проверять наличие report-файла в workspace ДО диспатча ревьюера.
- **apps/server e2e резолвит `@mymozhem/core` из dist** — перед `pnpm --filter @mymozhem/server test` обязателен `pnpm build`, иначе TS2305 на свежих экспортах (поймано дважды: Tasks 4 и 7).
- Jest-фильтр без `--` (ловушка «0 tests, exit 0») — уже в «Долгоживущих ограничениях»; фильтр всегда проверять на >0 матчей.

Перед стартом работ — Docker Desktop должен быть запущен (int/e2e/smoke поднимают контейнеры Postgres).

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

**Из membership/guest-join финального ревью** (три parked-minor'а подобраны транспортным срезом; health e2e placeholder — Task 9 его плана):
- гонка soft-delete/status-flip между проверкой и insert в `MembershipService.join` — принятый класс гонки (design fork (б)); acceptance в леджере; fail-safe (сиротская membership-строка безвредна);
- JSDoc на `RoomService.create`: словарь политики lowercase-in (`'registered'`) / Prisma-name-out (`'REGISTERED'`).

**Для плана realtime read / handshake:** проекции appSettings (ядро проецирует конфиг наравне с состоянием, ADR-008); handshake берёт готовые `TokenService.verifyAccessToken` и формат claims (`sub`, `sid`, `kind`, `roomId?`); write-path готов (`commitAppEvent`).

**Для плана realtime transport (решение владельца 2026-08-05 — подобрать ОБЯЗАТЕЛЬНО):** таблица маппинга core→contract кодов ошибок event-commit. Core-имена (дизайн §6, утверждены, НЕ переименованы) расходятся с SDK-резервациями: `ROOM_NOT_ACTIVE` vs `ROOM_LOG_SEALED`, `EVENT_TYPE_UNKNOWN` vs `EVENT_UNKNOWN_TYPE`, `EVENT_VISIBILITY_EXCEEDED` vs `EVENT_VISIBILITY_WEAKER_THAN_DECLARED`, `EVENT_EMIT_RATE_LIMITED` vs `EVENT_RATE_LIMITED` (при этом header realtime.errors.ts обещает маппинг в `RATE_LIMITED` — неоднозначность разрешить в таблице); parity держат `EVENT_PAYLOAD_INVALID`, `EVENT_PAYLOAD_TOO_LARGE`. Прецедент parity-документации — `room.errors.ts:10-12`. Прочие швы транспорта: wire-exposure commit (Socket.io `publish`), подстановка actorId из auth-контекста.

**Швы event-commit после среза (зафиксированы в плане, «Швы после среза»):** read-path (проекции, replay, курсор) → realtime read план; `soft_room_event_cap`/алерт/`room_event_cap_mode` → фаза 4; права эмита по ролям (SPECTATOR) → app-семантика, фаза 2.

**Deferred-миноры event-commit (оттриажены финальным ревью, ride — не гейтят):** `eventValidatorFor` игнорирует schema-аргумент на cache-hit (структурно безопасно при boot-реестре; hardening — вычислять схему внутри по ключу); некомпилируемая app-схема падает лениво на первом коммите, не при регистрации манифеста (кандидат для app-registration среза — boot-time compile-check, fail-closed); 6 точек ручного конструирования `EventLogService` в спеках дрейфуют при росте зависимостей (кандидат — test-module builder); размер-раньше-реестра → oversized payload для неизвестного типа даёт `EVENT_PAYLOAD_TOO_LARGE` (осознанный порядок, не дефект).

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
- Косметика: breadcrumb в `schema.prisma` о существовании рукописного CHECK; ассерт ортогональности soft-delete добавлен только для ветки CANCELLED (из трёх удаляемых статусов).

## Осталось недоделанным

- **Выбор следующего среза** (realtime read/handshake vs OAuth) — решение владельца.
- **Push `main`** (2 коммита впереди origin после handoff-коммита) — решение владельца.
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.
- **Судьба untracked `AGENTS.md`** в корне — вопрос владельцу открыт.

## Session 2026-08-05 (исполнение и мердж event-commit)

### Что сделано

- **Event-commit исполнен целиком (9/9 задач)** за одну сессию, subagent-driven (свежий имплементер на задачу + двухстадийное ревью; батч-ограничение «3 задачи на сессию» снято владельцем после batch 1). Все ревью задач — clean с первого прохода, fix-лупов не было.
- **Финальное whole-branch ревью (fable): With fixes** — 2 Important: TOCTOU в status-гейте (REQ-RT-016 держалось только последовательно) и сырой TypeError на нестрингифицируемом payload. По решению владельца оба исправлены до мерджа одной фикс-волной (`aefe96d`) + scoped re-review: все ADDRESSED, новых поломок нет.
- **Решения владельца на финальном ревью:** TOCTOU — чинить сейчас (санкционированное отступление от буквы дизайна §2); parity имён core-кодов с SDK — НЕ переименовывать, зафиксировать таблицу core→contract маппинга как обязательный шов realtime transport плана (см. follow-up выше).
- **Мердж по конвенции:** merge `phase-1-event-commit` → `main` (`0ae4608`, --no-ff), тесты на merged-результате зелёные, ветка удалена, `main` запушен (`e28daec..0ae4608` — включая докоммиты прошлой сессии).
- **LOC-снапшот** дописан (`4cef61b`): prod 2 959 / tests 3 767, ratio 1.27.

### Коммиты этой сессии

- `39f3a2e` config params · `c54d5a0` EventEmitLimiter · `ec7f15e` realtime errors + registry read-path · `f9e3076` EventLogService refactor (appendLocked) · `964859c` commitAppEvent chain · `2794691` rate-limit int-tests · `57b32ec` actorId lifecycle · `64d2447` concurrency tests · `aefe96d` TOCTOU + stringify fixes
- `0ae4608` merge(core): event-commit slice · `4cef61b` docs(stats): LOC snapshot
- (+ handoff-коммит этой правки)

### Локальное состояние (не в git)

- Docker Desktop запущен (int/e2e). `lt-pg` на 5432 нетронут.
- Untracked `AGENTS.md` — вопрос владельцу открыт.
- Леджер среза: `.superpowers/sdd/2026-08-04-event-commit-implementation-plan/progress.md` (полная история ревью/решений; не в git).
- Внешние side-effects: `git push origin main` (`e28daec..0ae4608`) — по выбору владельца «мёрдж в main» в меню завершения ветки (push следует конвенции прошлых срезов).

### Осталось недоделанным

- Выбор следующего среза — решение владельца.
- Push handoff/LOC коммитов — решение владельца.
- Юрист — гейт 1 открыт, действие вне агента.
