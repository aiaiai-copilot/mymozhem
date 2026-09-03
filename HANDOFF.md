# HANDOFF

**Date:** 2026-09-02 (OAuth-срез: **исполнение идёт — батчи 1-2/3 закрыты** (T1 SDK 1.4.0, T2 конфиг, T3 миграция, T4 TokenService, T5 provisioning, T6 OAuth-модуль — все review clean); **следующее действие — батч 3 (T7 transport, T8 e2e, T9 гейты + final review + merge) в новой сессии, в том же worktree**)
**Branch:** `feat/oauth-registered-rooms` (worktree `.claude/worktrees/oauth-slice`; 6 коммитов впереди `main` + handoff-коммиты; рабочее дерево чистое; не влито, push — решение владельца). `main` при этом несёт design+plan OAuth (`a669fed`, `8afec8d`) и стоит на `44db424`.

**Состояние фазы 1.** SDK contract core, сервис регистрации манифеста, Room lifecycle, Identity minimal seam, Lifecycle-эмит в лог, appSettings write path, Membership/guest-join, транспортный auth/HTTP, event-commit, realtime read/handshake (полный duplex), membership-exclusion (исключение участника + немедленный отзыв доступа, rejoin-блок по IP) — реализованы и слиты в `main`. Критерии выхода ф.1 по realtime и по исключению (ф.1 «немедленный отзыв подписки») подтверждены e2e на проводе. Леджеры исполнения срезов: `.superpowers/sdd/*/progress.md` (не в git, только на этой машине). Этап продукта — MVP. Метод — AIDD / Specification-Driven.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. Этот файл целиком.
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `.superpowers/sdd/*/progress.md` — леджеры исполнения прежних срезов (не в git, только на этой машине; `git clean -fdx` уничтожит). **Леджер OAuth-среза живёт в worktree:** `.claude/worktrees/oauth-slice/.superpowers/sdd/2026-09-02-oauth-implementation-plan/progress.md` — там батчи, deferred-миноры, briefs task-1..9, reports, review-пакеты. Леджера среза исключения на машине нет — его история: план + `git log` (диапазон `89d887f..c2e60da`).
6. `docs/sessions/2026-08-18-membership-exclusion-{design,implementation-plan}.md` — исполненные дизайн+план среза исключения (9/9, работа в коммитах; читать при разборе истории, §0 дизайна — решения владельца).
7. **`docs/sessions/2026-09-02-oauth-{design,implementation-plan}.md` — вход текущего среза (исполняется).** Дизайн §0 — решения владельца (не переоткрывать); план — 9 тасков; прогресс — в леджере worktree (п.5).
8. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы и дизайны прежних срезов (включая realtime: `docs/sessions/2026-08-05-realtime-read-handshake-{design,implementation-plan}.md`) читать при разборе истории — их работа в коммитах. Состояние на конец прошлой сессии: `git show 4cab30c:HANDOFF.md`.

## Следующее действие

**OAuth-срез, батч 3/3 (T7 transport — OAuth-эндпоинты + POST /rooms + ветки фильтра → T8 e2e на проводе → T9 гейты; затем final whole-branch review + finishing-a-development-branch) — в новой сессии** (правило владельца «батч = новая сессия»; батчи 1-2 закрыты review clean в сессии 2026-09-02 — батч 2 по указанию владельца шёл в той же сессии, что батч 1). Старт: открыть worktree `.claude/worktrees/oauth-slice` (ветка `feat/oauth-registered-rooms`), прочитать леджер `.superpowers/sdd/2026-09-02-oauth-implementation-plan/progress.md` внутри worktree — там состояние, deferred-миноры для триажа на final review, briefs T7-T9, reports; продолжить subagent-driven-development с Task 7 (BASE = HEAD ветки). Примечание для T7 от ревью T6: `OAUTH_EXCHANGE_FAILED` message интерполирует provider error message — наружу тело ровно `{code}` (REQ-SEC-006), но warn-лог фильтра это увидит.

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
- **Для web-client-среза:** CORS без `credentials: true` + SameSite=Strict — клиент с другого origin не сможет использовать refresh-куку (сейчас корректно для same-origin).
- Негативные strictObject-кейсы для ack-схем SDK (минор Task 2); экспорт realtime-фикстур из SDK index — при первом внешнем потребителе.
- Из membership/guest-join: гонка soft-delete/status-flip в `MembershipService.join` — принятый класс гонки (design fork (б)); JSDoc на `RoomService.create` про lowercase-in/Prisma-name-out.
- Deferred-миноры event-commit (ride): `eventValidatorFor` игнорирует schema-аргумент на cache-hit; некомпилируемая app-схема падает лениво (кандидат boot-time compile-check в app-registration срез); 6 точек ручного конструирования `EventLogService` в спеках дрейфуют (кандидат — test-module builder; после realtime-среза таких точек стало больше — вес вырос).

## Два гейта над фазами

1. **Юрист** — до первого события с посторонними или призами. Список вопросов готов (`docs/legal/questions-for-lawyer.md`). Блокирует старт работы с реальными PII, не блокирует реализацию.
2. **Первое живое событие** — до тяжёлых вложений в фазу 3 (rewards/лотерея).

## Долгоживущие ограничения, введённые срезами

- **Замороженные миграции:** `20260718061612_room_lifecycle`, `20260722151900_identity_seam`, `20260722153952_room_organizer_fk`, `20260722180147_realtime_log_event`, `20260723090841_room_app_config`, `20260729164500_membership_guest_join`, `20260730101037_auth_sessions`, `20260819154552_membership_exclusion`, `20260902191322_oauth_identity_provider`. Любое изменение — только новой миграцией.
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

- **Исполнение OAuth-среза — батч 3** (батчи 1-2/3 закрыты: T1-T6, review clean) — новая сессия, см. «Следующее действие».
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.
- **CLAUDE.md несёт устаревший указатель точки входа** (`docs/sessions/handoff-to-aidd-session.md` вместо `HANDOFF.md`) и развилку turbo/nx как нерешённую — AGENTS.md синхронизирован, CLAUDE.md не тронут (решение владельца).

## Session 2026-09-02 (OAuth-срез: исполнение, батчи 1-2/3 — T1-T6)

### Что сделано

- **Subagent-driven-development** по плану `8afec8d` в worktree `.claude/worktrees/oauth-slice` (ветка `feat/oauth-registered-rooms` от `main @ 44db424`). Baseline зелёный; pre-flight скан плана чистый (14 пар producer→consumer, таблица — в леджере). Каждый таск: implementer-субагент → ревью (spec + quality) → ledger.
- **T1 SDK 1.4.0** (`035eae4`): 8 wire-кодов (ROOM_ORGANIZER_NOT_REGISTERED + 7 OAUTH_*), createRoomRequest/Response, oauth start/callback query-схемы, `CONTRACT_VERSION = '1.4.0'`. Review clean.
- **T2 конфиг** (`67def04`): опциональная Google-секция all-or-none (superRefine), `OAUTH_REDIRECT_ALLOWLIST` non-empty при сконфигурированном Google, `OAUTH_STATE_TTL` (60…1800, def 600), `OAUTH_RATE_LIMIT` (def 10); `REFRESH_TOKEN_TTL` 86 400…7 776 000, def 2 592 000, superRefine `REFRESH ≤ GUEST_TTL` **снят** (cap — в точках выдачи, design §5); TEST_CONFIG обновлён. Review clean.
- **T3 миграция** (`233c40b`): `identity."IdentityProvider"` (unique(provider,subject), index(identityId), FK→Identity RESTRICT), SQL сгенерирован без ручных правок; int-спек наличия (REQ-DEV-006) 1/1. Review clean.
- **T4 TokenService** (`2b9f321`): `IssuedTokens.kind`, `issueRegisteredTokens` (claims без roomId, TTL без guest-cap), `sessionExpiry(kind)` ⇄ `setRefreshCookie(kind)` — «одна норма в двух местах»; rotate по `identity.kind`; reuse-detection для REGISTERED подтверждён int-спеком. Review clean.
- **T5 provisioning** (`8960301`): `IdentityError`/`IDENTITY_ERROR_CODES`; `findOrCreateByProvider` — self-contained транзакция, email fail-closed (write-once, case-insensitive, без автолинка), deletedAt → PROVIDER_IDENTITY_GONE, гонка → конвергенция. **Санкционированное отклонение от сниппета плана:** twin re-check в ветке email-конфликта — пречек сам подвержен гонке (проигравший видел identity близнеца → EMAIL_CONFLICT вместо повторного логина; поймано собственным race-кейсом плана), фикс в рамках design §4, reviewer verdict — sound. Review clean.
- **T6 OAuth-модуль** (`24e4e3b`): порт `OAuthProviderClient` + DI-токен, `OAuthService` (state double-submit + PKCE S256 + allowlist с перепроверкой на complete, fail-order по design §7), `GoogleOAuthClient` (единственный файл с сетью Google, loose-схемы, email_verified fail-closed), `OAuthModule`, баррел. Мелкие санкционированные отклонения: email-фикстура спека под `z.email()` v4, type-импорт ProviderProfile. Review clean.
- Батчи: владелец разбил исполнение на 3 батча; батч 2 выполнен в этой же сессии по его указанию; батч 3 (T7-T9 + final review + merge) — новая сессия.

### Коммиты этой сессии

- `035eae4` feat(sdk): контракт 1.4.0 — OAuth wire-коды, createRoom DTO, oauth query-схемы (REQ-ID-015/009)
- `67def04` feat(core): конфиг — опциональная Google-секция all-or-none, REFRESH_TOKEN_TTL к §4 пакета (REQ-OPS-003, REQ-ID-009)
- `233c40b` feat(core): миграция oauth_identity_provider — таблица IdentityProvider (REQ-ID-015)
- `2b9f321` feat(core): REGISTERED-выдача токенов без guest-cap — sessionExpiry/cookie по kind (REQ-ID-016, design §5)
- `8960301` feat(core): IdentityService.findOrCreateByProvider — provisioning REGISTERED по (provider, sub), fail-closed email (REQ-ID-015)
- `24e4e3b` feat(core): OAuth-модуль — порт провайдера, OAuthService (state+PKCE+allowlist), GoogleOAuthClient (REQ-ID-015/009)
- (+ handoff-коммиты этой правки)

### Локальное состояние (не в git)

- **Worktree** `.claude/worktrees/oauth-slice` — НЕ удалять: в нём леджер `.superpowers/sdd/2026-09-02-oauth-implementation-plan/` (батчи, deferred-миноры, briefs T1-T9, reports, review-пакеты) и вся незавершённая работа среза.
- Docker: authoring-контейнер `mm-migrate-oauth` (порт 55434) создан и удалён в T3; чужие `lt-pg`/`lt-pg-sdd` не тронуты.
- Side-effects на внешние системы: нет (push не выполнялся; ветка только локально).

### Осталось недоделанным

- Батч 3 (T7-T9 + final whole-branch review + merge) — новая сессия (см. «Следующее действие»). Deferred-миноры T1-T6 — в леджере worktree, триаж на final review.
