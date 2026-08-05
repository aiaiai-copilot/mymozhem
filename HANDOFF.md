# HANDOFF

**Date:** 2026-08-05 (срез **realtime read/handshake** выбран, спроектирован и распланирован — дизайн `a749423`, план `1647f2b`, оба утверждены владельцем; **исполнение НЕ начато** — оно и есть следующая сессия; **push — решение владельца**)
**Branch:** `main` (на 5 коммитов впереди `origin/main`: LOC-снапшот + handoff event-commit + дизайн + план + handoff этой сессии; untracked `AGENTS.md` — не сессионный, не трогать).

**Состояние фазы 1.** SDK contract core, сервис регистрации манифеста, Room lifecycle, Identity minimal seam, Lifecycle-эмит в лог, appSettings write path, Membership/guest-join, транспортный auth/HTTP, event-commit — реализованы и слиты в `main`. **Realtime read/handshake (полный duplex) — распланирован, ждёт исполнения.** Леджеры исполнения срезов: `.superpowers/sdd/*/progress.md` (не в git, только на этой машине). Этап продукта — MVP. Метод — AIDD / Specification-Driven.

**Что построил срез (event-commit):** `EventLogService.commitAppEvent` — запись app-событий в лог ядра: commit-цепочка из 8 шагов до advisory lock (status-гейт ACTIVE = запечатывание REQ-RT-016; per-actor лимит попыток REQ-RT-014 в объёме v1.3; размер REQ-RT-012; реестр+схема REQ-CTR-008; потолок видимости REQ-CTR-009 через `isWithinCeiling`; membership-гейт; append через общий приватный `appendLocked`), плюс **post-lock перечитывание статуса** (TOCTOU-фикс финального ревью — санкционированное владельцем отступление от буквы дизайна §2 «все проверки до lock»; payload-нейтральность REQ-RT-007 сохранена). Конфиг `EVENT_EMIT_RATE_LIMIT_PER_MIN`/`MAX_EVENT_PAYLOAD_BYTES` (REQ-OPS-003); типизированные realtime-ошибки (7 кодов); event read-path в `AppRegistryService`; actorId в lifecycle-эмит через `transition` (REQ-RT-009, service-уровень); характеризующие тесты конкурентного seq и payload-нейтральности (критерий выхода ф.1). Гейты на мердже: build/lint/typecheck/test(330)/test:int(106)/boundary-check/guardrails — зелёные.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. **`docs/sessions/2026-08-05-realtime-read-handshake-design.md` + `2026-08-05-realtime-read-handshake-implementation-plan.md` — ЖИВОЙ ФРОНТ: утверждённый дизайн и план следующего среза. Исполнять план.** Решения владельца — §0 дизайна (не переоткрывать при исполнении).
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `.superpowers/sdd/2026-07-29-membership-guest-join-implementation-plan/progress.md`, `.superpowers/sdd/2026-07-30-transport-http-auth-implementation-plan/progress.md`, `.superpowers/sdd/2026-08-04-event-commit-implementation-plan/progress.md` — леджеры завершённых срезов (не переисполнять). Леджеры не в git (`.superpowers/` игнорируется) — существуют только на этой машине; `git clean -fdx` уничтожит. Новый леджер realtime-среза создаётся рядом по той же конвенции.
6. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы прежних срезов (sdk-contract-core, app-registry, room-lifecycle, identity-minimal-seam, realtime-log-lifecycle-emit, appsettings-write-path, membership-guest-join, transport-http-auth, event-commit) читать только при разборе истории — их работа в коммитах.

## Следующее действие

**Исполнение плана realtime read/handshake — subagent-driven, батчами по 3 задачи** (решение владельца 2026-08-05; батч-ограничение подтверждено). План: `docs/sessions/2026-08-05-realtime-read-handshake-implementation-plan.md` — 9 задач: (1) конфиг RECONNECT_RATE_LIMIT_PER_MIN → (2) SDK 1.2.0 wire-конверты + ACTOR_NOT_MEMBER → (3) таблица маппинга core→contract → (4) ProjectionService → (5) EventOutbox+RealtimeBus+переход RoomService на runner (атомарная, широкая) → (6) SubscriptionRegistry+findActiveMembership → (7) RealtimeGateway+IoAdapter → (8) e2e socket.io-client → (9) финальные гейты. Перед стартом — Docker Desktop запущен. После мерджа среза: LOC-снапшот по методике `docs/stats/loc-snapshots.md`.

**Дальше после realtime:** OAuth-срез (`POST /rooms` + Google-флоу, REQ-ID-015/009) либо срез исключения (membership + вызов `SubscriptionRegistry.revokeRoomAccess` — закроет критерий ф.1 «немедленный отзыв подписки» целиком) — решение владельца.

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
- при появлении транспорта: зафиксировать в контрактных доках допущение «settings — не-null JSON value».

**Из membership/guest-join финального ревью** (три parked-minor'а подобраны транспортным срезом; health e2e placeholder — Task 9 его плана):
- гонка soft-delete/status-flip между проверкой и insert в `MembershipService.join` — принятый класс гонки (design fork (б)); acceptance в леджере; fail-safe (сиротская membership-строка безвредна);
- JSDoc на `RoomService.create`: словарь политики lowercase-in (`'registered'`) / Prisma-name-out (`'REGISTERED'`).

**Follow-up'ы realtime-транспорта ПОДОБРАНЫ дизайном среза** (`2026-08-05-realtime-read-handshake-design.md`): таблица маппинга core→contract — design §3 (включая разрешение неоднозначности `EVENT_RATE_LIMITED` vs `RATE_LIMITED` — §0.4, и новый код `ACTOR_NOT_MEMBER` — §0.5); wire-exposure commit (Socket.io `publish`) и подстановка actorId из auth-контекста — design §5; проекции appSettings — design §6; handshake на `verifyAccessToken` + claims — design §4.

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

- **Исполнение плана realtime read/handshake** (9 задач, subagent-driven, батчи по 3) — следующая сессия.
- **Push `main`** (5 коммитов впереди origin после handoff-коммита) — решение владельца.
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.
- **Судьба untracked `AGENTS.md`** в корне — вопрос владельцу открыт.

## Session 2026-08-05 (дизайн и план realtime read/handshake)

### Что сделано

- **Выбран срез realtime read/handshake** (альтернатива — OAuth-срез; решение владельца) и пройден полный цикл brainstorm → дизайн → план.
- **Дизайн утверждён по секциям** (`2026-08-05-realtime-read-handshake-design.md`). Ключевые решения владельца (§0): скоуп — полный duplex (handshake + subscribe/replay + live-доставка + publish в `commitAppEvent` + полная таблица маппинга); REQ-SEC-003 — hook `revokeRoomAccess` + реестр подписок сейчас, flow исключения — отдельный membership-срез; fan-out — **ALS-outbox fail-closed** (подход A; caller-side publish и LISTEN/NOTIFY отклонены); `EVENT_EMIT_RATE_LIMITED → EVENT_RATE_LIMITED` (НЕ `RATE_LIMITED` — тот остаётся транспортным); новый аддитивный код `ACTOR_NOT_MEMBER` в SDK; дефолт `visibility` в publish = потолок типа; per-event re-check членства в live-доставке не делаем.
- **План утверждён** (`2026-08-05-realtime-read-handshake-implementation-plan.md`): 9 задач, TDD, контрактные тесты первыми; SDK minor-бамп 1.2.0; миграций БД нет; новые зависимости — socket.io + @nestjs/websockets + @nestjs/platform-socket.io (core), socket.io-client (server, dev).
- Исполнение в этой сессии **не начиналось** — перенесено в новую сессию по решению владельца (subagent-driven, батчи по 3 задачи).

### Коммиты этой сессии

- `a749423` docs(design): realtime read/handshake — полный duplex-транспорт
- `1647f2b` docs(plan): realtime read/handshake — 9 задач
- (+ handoff-коммит этой правки)

### Локальное состояние (не в git)

- Docker Desktop был запущен на момент сессии (нужен для int/e2e следующей сессии). `lt-pg` на 5432 нетронут.
- Untracked `AGENTS.md` — вопрос владельцу открыт.
- Леджеров новых нет — леджер среза создастся при исполнении (`.superpowers/sdd/2026-08-05-realtime-read-handshake-implementation-plan/progress.md`).
- Внешних side-effects нет (код не писался, push не делался).

### Осталось недоделанным

- Исполнение плана — следующая сессия (см. «Следующее действие»).
- Push handoff/design/plan коммитов — решение владельца.
- Юрист — гейт 1 открыт, действие вне агента.
