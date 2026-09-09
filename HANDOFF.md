# HANDOFF

**Date:** 2026-09-09 (**фаза 1 закрыта по сверке критериев** — `docs/sessions/2026-09-09-phase-1-exit-audit.md`: 10/11 критериев подтверждены артефактами, kind-флип снят amendment v1.3, пробел REQ-ID-012 разрешён **amendment v1.4** (перенос админ-контура в ф.4, решение владельца), буквальный DB-down тест REQ-DEV-008 добавлен; конвейер зелёный; **следующее — фаза 2 (Quiz), новый срез в новой сессии, решение владельца**; push — решение владельца)
**Branch:** `main` (10 коммитов впереди `origin/main`: OAuth-срез + мердж + handoff 2026-09-03, сверка ф.1 + DB-down тест/амendment v1.4 этой сессии; рабочее дерево чистое). Push — решение владельца.

**Состояние фазы 1 — ЗАКРЫТА.** SDK contract core, сервис регистрации манифеста, Room lifecycle, Identity minimal seam, Lifecycle-эмит в лог, appSettings write path, Membership/guest-join, транспортный auth/HTTP, event-commit, realtime read/handshake (полный duplex), membership-exclusion (исключение участника + немедленный отзыв доступа, rejoin-блок по IP), **OAuth-срез (Google login + POST /rooms + REGISTERED-токены без guest-cap, контракт 1.4.0)** — реализованы и слиты в `main`; 2026-09-09 сверкой критериев подтверждено закрытие фазы целиком (включая запечатывание лога REQ-RT-016 — оно вошло в event-commit срез). Леджеры исполнения срезов: `.superpowers/sdd/*/progress.md` (не в git, только на этой машине). Этап продукта — MVP. Метод — AIDD / Specification-Driven.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. Этот файл целиком.
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `docs/spec/amendment-v1.4-admin-contour.md` — **утверждённый перенос REQ-ID-012 (админ-контур) в ф.4** (решение владельца 2026-09-09, по итогам сверки ф.1).
6. `docs/sessions/2026-09-09-phase-1-exit-audit.md` — **сверка критериев выхода ф.1** (вердикт: фаза 1 закрыта; таблица критерий → артефакт).
7. `.superpowers/sdd/*/progress.md` — леджеры исполнения прежних срезов (не в git, только на этой машине; `git clean -fdx` уничтожит). Леджеров срезов исключения и OAuth на машине нет — их история: планы + `git log` (исключение `89d887f..c2e60da`, OAuth `44db424..ab973f4`).
8. `docs/sessions/2026-08-18-membership-exclusion-{design,implementation-plan}.md` — исполненные дизайн+план среза исключения (9/9, работа в коммитах; читать при разборе истории, §0 дизайна — решения владельца).
9. `docs/sessions/2026-09-02-oauth-{design,implementation-plan}.md` — исполненные дизайн+план OAuth-среза (9/9 + final review + ZodError-фикс, работа в коммитах; §0 дизайна — решения владельца).
10. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы и дизайны прежних срезов (включая realtime: `docs/sessions/2026-08-05-realtime-read-handshake-{design,implementation-plan}.md`) читать при разборе истории — их работа в коммитах. Состояние на конец прошлой сессии: `git show 4cab30c:HANDOFF.md`.

## Следующее действие

**Фаза 1 закрыта (сверка 2026-09-09). Следующий срез — фаза 2 (Quiz, первый app-модуль); старт — новой сессией, решение владельца** (правило «новый срез = новая сессия», подтверждено 2026-09-02; внутри среза владелец разрешил исполнение всех батчей в одной сессии). Выбранный было срез «запечатывание лога (REQ-RT-016)» оказался уже закрытым event-commit срезом — вместо него выполнена сверка критериев ф.1. Перед первым живым событием остаётся **manual smoke с реальными Google-кредами** (e2e — на fake-провайдере; design §10; действие владельца). Push на origin — решение владельца. Гейты над фазами — см. раздел ниже (юрист до первого события с посторонними/призами).

**Остаточные риски, принятые мерджем (realtime-срез):**
- **Duplicate-acceptance в subscribe** (осознанный trade-off дизайна §4): join каналов — ДО чтения лога, поэтому событие, закоммиченное между join и чтением, придёт и live, и в snapshot. Клиент без seq/cursor (REQ-RT-011a) дедуплицировать не может — принято для MVP; ссылка для фазовой работы над курсором (ф.4).
- **Deferred-миноры финального ревью (ride, триаж «не гейтят»):** M-2 — мёртвая инжекция `config` в RealtimeGateway (убрать при следующем касании); M-4 — cross-socket timing в live-visibility e2e (микроскопическое окно флейка; маркер на organizer-сокете сделает детерминированным); M-5 — `asLogEvent` fallback fail-open (`?? row.visibility`) — fail-closed throw при следующем расширении enum EventVisibility. (M-3 — stale registry entry — **закрыт срезом исключения**, `74035f9`.)
- Риски прошлых срезов (refresh-ротация strict, access-токены ≤15 мин после терминации, `/health/ready` 503) неизменны — `git show 3d7de83:HANDOFF.md`.

**Санкционированные отклонения OAuth-среза** (прошли ревью, зафиксированы в леджере среза; леджер удалён с worktree — история в `git log 44db424..ab973f4`):
1. **T5:** twin re-check `findUnique(provider_subject)` внутри ветки email-конфликта `findOrCreateByProvider` — пречек конфликта сам подвержен гонке (проигравший видел identity близнеца → EMAIL_CONFLICT вместо повторного логина; поймано race-кейсом самого плана); фикс в рамках design §4, reviewer verdict sound.
2. **T6:** email-фикстура google-client спека `alex@example.com` вместо `a@b.c` (zod v4 `z.email()` отклоняет односимвольный TLD) + type-only импорт ProviderProfile.
3. **T7:** POST /rooms возвращает `joinPolicy` из валидированного запроса, не из Prisma-строки (Prisma-enum `'GUESTS'` vs SDK wire lowercase `'guests'` — сниппет плана не компилировался и лил uppercase на провод; echo === persisted по контракту `RoomService.create`).
4. **T8:** `ReplyLike.redirect` и оба call-site'а — сигнатура fastify v5 `redirect(url, code?)` (плановая декларация кодировала порядок v4; e2e поймал 500 на всех /auth/google*).
5. **Final review:** ZodError-гард в exchange-catch OAuthService — `ZodError.message` (JSON-дамп issues) мог нести PII провайдера в серверный лог (`4bb08e1`).

**Опыт OAuth-среза для следующих:**
- **Мердж ветки со схемным изменением требует `prisma generate` на main** — worktree нёс свой сгенерированный клиент, main остался со stale (typecheck/int/e2e падают с `Property 'identityProvider' does not exist` — диагноз по первой ошибке, не по «мердж сломал»).
- **Структурный тип транспорта может кодировать неверную сигнатуру адаптера** — `ReplyLike.redirect` воссоздавал fastify v4 под fastify 5; unit-фейки такой дрейф не видят принципиально, ловится только wire-e2e. При расширении `ReplyLike` сверять сигнатуру с исходником fastify.
- **jest `-t` матчит имена тестов, не describe-файлы** — фильтры в планах формулировать по имени теста/describe или гонять спек по пути; проверять >0 матчей.
- **Демон контейнеров (OrbStack) может зависнуть** — симптом: testcontainers-лане каскадные таймауты (33 мин вместо 7 с) при зелёном коде; диагноз: `docker ps` висит. Лечение `orbctl restart docker` — дёргает ВСЕ контейнеры машины; `--rm`-контейнеры при этом удаляются.

**Санкционированные владельцем отклонения от плана realtime-среза** (все прошли ревью, зафиксированы в леджере):
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
- **Инвариант «change both or neither» (теперь ТРИ места, с OAuth-среза):** предикат `kind = 'REGISTERED' AND deletedAt IS NULL` живёт в частичном индексе `"Identity_registered_email_key"`, guarded INSERT в `RoomService.create` и пречеке конфликта в `IdentityService.findOrCreateByProvider`. Менять только вместе. (Комментарий в `room.service.ts:82-83` всё ещё говорит «два места» — известный дрейф, поправить при следующем касании.)
- **Хост-порты 5432 и 55432:** контейнеры `lt-pg`/`lt-pg-sdd` (не проектные) были удалены 2026-09-03 рестартом OrbStack и не восстановлены — на 2026-09-09 порты свободны, перед публикацией authoring-контейнера всё равно проверять `docker ps`.
- **Testcontainers v12 + OrbStack — две ловушки restart'а контейнера** (вскрыты DB-down тестом 2026-09-09): (1) у Started-контейнера нет `start()`, а `StoppedTestContainer` — только метаданные: stop/start идут через `getContainerRuntimeClient()` (`client.container.stop/start(getById(id))`); (2) **OrbStack переназначает случайный host-порт при restart** — старый пул мёртв навсегда, клиент пересоздаётся на фактический порт из `inspect`. Оба приёма зашиты в харнесс (`stopContainer`/`startContainer`, последний возвращает новый `PrismaService`).
- **`prisma migrate dev` не всегда регенерирует клиент; явный `pnpm exec prisma generate` требует DATABASE_URL** и cwd = корень репозитория. Prisma 7 CLI вообще работает только из корня репо (`prisma.config.ts` там): форма `pnpm --filter @mymozhem/core exec prisma …` падает — использовать `pnpm exec prisma …` из корня.
- **`packages/core/src/testing/postgres.testcontainer.ts` — переиспользуемый паттерн ядра.** Мутирует глобальный `process.env.DATABASE_URL` без восстановления (безопасно только при `maxWorkers: 1`); требует cwd = корень репозитория. С 2026-09-09 несёт `stopContainer`/`startContainer` для тестов недоступности БД (REQ-DEV-008, `db-down.int-spec.ts`).
- **`ReplyLike` — адаптер fastify 5:** сигнатуры сверять с fastify 5 (`redirect(url, code?)`, code дефолт 302). OAuth-куки (`mm_oauth_*`) — `SameSite=Lax` осознанно (возврат с Google — top-level GET), path `/auth`, TTL `OAUTH_STATE_TTL`; refresh-кука остаётся `Strict`. Гостевой cap refresh — ТОЛЬКО в точках выдачи (`TokenService.sessionExpiry` ⇄ `setRefreshCookie` — «одна норма в двух местах», менять вместе); конфиг-инварианта `REFRESH ≤ GUEST_TTL` больше нет.
- **Прогон интеграционной ланы поднимают контейнеры Postgres** (~8 с локально на файл). Docker Desktop должен быть запущен.
- **Jest CLI:** форма `pnpm --filter @mymozhem/core test:int -- -t "..."` миспарсится — рабочая форма без `--`. Фильтр всегда проверять на >0 матчей.
- **apps/server e2e резолвит `@mymozhem/core` из dist** — перед `pnpm --filter @mymozhem/server test` обязателен `pnpm build`; core резолвит `@mymozhem/sdk` из dist — после правок SDK `pnpm --filter @mymozhem/sdk build`.

## Отложенные follow-up (не гейтят; полный список с обоснованиями — в леджерах)

- **OAuth-срез (триаж финального ревью — все follow-up):** unit на `setRefreshCookie` (maxAge-тернарник покрыт только зеркально); `createRoomResponseSchema.parse` на границе POST /rooms (сейчас echo-инвариант на контракте сервиса); deletedAt-гард в P2002 winner-ветке `findOrCreateByProvider`; cross-account email-гонка → raw P2002 → 400 вместо OAUTH_EMAIL_CONFLICT (различать индекс по `err.meta.target` — дизайн-решение); очистка oauth-кук при rate-limit/zod-отказах callback (сейчас живут до TTL ≤ 600 с — не ослабление, сознательно); поправить комментарий «два места» в `room.service.ts`; опечатка REQ-ID-015→REQ-ID-005 в комментарии `ROOM_ORGANIZER_NOT_REGISTERED` (sdk error-codes); непокрытые мелочи тестов: Max-Age/Secure oauth-кук, start-лимитер, точный статус /rooms/join в REQ-SEC-006 батарее; `oauthCallbackQuerySchema` strict — лишний query-параметр (utm_*) даст 400, помнить при web-client-срезе.

- **Вынести testing-экспорты из prod-баррела core** в отдельный entry point — при этом починить `create-room.mjs` обратно на баррел (его dist-subpath-импорты молча сломаются при появлении `exports` в core). После realtime-среза скрипт дополнительно конструирует RealtimeBus/EventOutbox.
- **`create-room.mjs`: findFirst по точному `email`, а индекс — по `lower(email)`** — при кейс-варианте будет сырая unique-violation вместо reuse.
- **`updateManyAndReturn` доступен на Prisma 7.8.0** — схлопнет 3 запроса в 2 в мутациях `RoomService` (transition/softDelete/configure). **Осторожно:** transition теперь работает внутри `outbox.run` с staging — рефакторинг не должен разорвать атомарность «UPDATE + лог + staged-доставка».
- **Нет гейта на дрейф миграций** (`prisma migrate diff --from-migrations` непригоден без `datasource.shadowDatabaseUrl` в `prisma.config.ts`).
- **Общая рекурсивная `jsonValueSchema`** для payload в `log-event`/`projected-event` — `z.record(z.string(), z.unknown())` не принуждает структурно REQ-CTR-002.
- Косметика: breadcrumb в `schema.prisma` о рукописном CHECK; ассерт ортогональности soft-delete только для CANCELLED.

## Осталось недоделанным

- **Фаза 2 (Quiz) не начата** — старт новым срезом в новой сессии, решение владельца (см. «Следующее действие»); **manual smoke OAuth с реальными Google-кредами** перед первым живым событием — действие владельца.
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.
- **CLAUDE.md несёт устаревший указатель точки входа** (`docs/sessions/handoff-to-aidd-session.md` вместо `HANDOFF.md`) и развилку turbo/nx как нерешённую — AGENTS.md синхронизирован, CLAUDE.md не тронут (решение владельца).

## Session 2026-09-09 (сверка критериев ф.1 → фаза 1 закрыта; amendment v1.4; DB-down тест)

### Что сделано

- **Выбранный владельцем срез «запечатывание лога (REQ-RT-016)» при верификации оказался уже закрытым** event-commit срезом 2026-08-04 (status-гейт + TOCTOU re-check в `appendLocked`, int-тесты `event-commit.int-spec.ts:155/495`, e2e `realtime.e2e-spec.ts:247` ROOM_LOG_SEALED). Срез не строился — вместо изобретения работы выполнена сверка.
- **Сверка критериев выхода ф.1** — `docs/sessions/2026-09-09-phase-1-exit-audit.md` (`ec647d1`): каждый критерий §5 пакета (с поправками amendment v1.3 §2) подтверждён артефактом (файл:строка). 10/11 закрыты, критерий kind-флипа снят amendment v1.3.
- **Два пробела разрешены решениями владельца:** (1) REQ-ID-012 (админ-контур) — не был ни реализован, ни документально отложен → **amendment v1.4** (`docs/spec/amendment-v1.4-admin-contour.md`): перенос в ф.4 по фильтру задела, текст и MUST нормы не тронуты; (2) буквальный DB-down тест REQ-DEV-008 → **`db-down.int-spec.ts`** (2 теста: commit и join при реально остановленном Postgres отклоняются, частичной записи нет — верификация по той же БД после поднятия). Харнесс расширен `stopContainer`/`startContainer`.
- **Гейты зелёные:** build → lint → typecheck → boundary-check → guardrails → test:int (15 сьютов, 144 теста) → test. Вердикт: **фаза 1 закрыта**; следующее — фаза 2 (Quiz), новый срез в новой сессии, решение владельца.

### Коммиты этой сессии

- `ec647d1` docs(audit): сверка критериев выхода фазы 1 · `0b5e599` test(core): DB-down тест REQ-DEV-008 + амендмент v1.4 (REQ-ID-012 → ф.4) · (+ handoff этой правки)

### Локальное состояние (не в git)

- Docker-демон — **OrbStack**; работает стабильно (в отличие от зависания 2026-09-03). Запущенных контейнеров нет; `lt-pg`/`lt-pg-sdd` не восстановлены (порты 5432/55432 свободны); остановленный `pay-per-service-db-1` — не проектный, не трогать. Временный probe-контейнер `mm-pg-restart-probe`/`mm-pg-port-probe` создан и удалён в ходе диагностики.
- Side-effects на внешние системы: нет (push не выполнялся — 10+ коммитов впереди `origin/main`, решение владельца).

### Осталось недоделанным

- См. одноимённый раздел выше (фаза 2 — новый срез; manual smoke OAuth; юрист; CLAUDE.md-указатель).
