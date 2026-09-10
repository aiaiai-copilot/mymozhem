# HANDOFF

**Date:** 2026-09-10 (девятая сессия: **написан план реализации фазы 3** — `docs/sessions/2026-09-10-rewards-lottery-implementation-plan.md`, 13 задач в 5 батчах; развилки из дизайна §8 решены владельцем: ajv-formats на commit-гейте = Task 1, lint-запрет Math.random = включён в Task 11).
**Branch:** `main`, впереди origin на 4 коммита (`1bb830c`, `7a32e33` дизайн ф.3, `922fe2c`, `9d45fe2` план ф.3); push — решение владельца; рабочее дерево чистое. Конвейер не запускался — сессия без кода (только docs).
**Worktree среза:** `.worktrees/quiz` (ветка `quiz`) после мерджа удалён; леджер SDD перенесён в `.superpowers/sdd/2026-09-09-quiz-implementation-plan/progress.md` основного чекаута (не в git, только на этой машине).

**Состояние фаз: фаза 1 ЗАКРЫТА (2026-09-09), фаза 2 (Quiz) ЗАКРЫТА (2026-09-10), фаза 3 — ДИЗАЙН УТВЕРЖДЁН (2026-09-10), реализация заблокирована гейтом 2** (решение владельца в дизайн-сессии: старт реализации — после первого живого события, отдельным решением). Ядро ф.1 (identity, room lifecycle, membership/guest-join/exclusion, realtime полный duplex, event-commit, appSettings, OAuth Google + POST /rooms) и Quiz-срез ф.2 (SDK 1.5.0 рантайм-контракт app-модулей, app-runtime «командный хост» в ядре, пакет `@mymozhem/app-quiz` — манифест, 7 типов событий, чистый редьюсер, скоростная шкала, анти-бот REQ-RT-013, роль SPECTATOR) — реализованы и слиты в `main`. Сверки: `2026-09-09-phase-1-exit-audit.md`, `2026-09-10-phase-2-exit-audit.md`. Этап продукта — MVP. Метод — AIDD / Specification-Driven.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. Этот файл целиком.
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — утверждённая пере-разметка фаз.
5. `docs/spec/amendment-v1.4-admin-contour.md` — перенос REQ-ID-012 (админ-контур) в ф.4.
6. `docs/sessions/2026-09-09-phase-1-exit-audit.md` и `docs/sessions/2026-09-10-phase-2-exit-audit.md` — сверки критериев выхода ф.1 и ф.2 (обе фазы закрыты).
7. `docs/sessions/2026-09-09-quiz-module-design.md` — утверждённый дизайн Quiz-среза (§0 — решения владельца; §3 — erratum нейминга dotted-lowercase) — читать как образец перед дизайном следующего app-модуля.
8. `docs/sessions/2026-09-10-rewards-lottery-design.md` — **утверждённый дизайн фазы 3** (§0 — решения владельца, включая гейт 2: реализация после первого живого события).
9. `docs/sessions/2026-09-10-rewards-lottery-implementation-plan.md` — **план фазы 3** (13 задач, батчи A–E по 3 задачи; интерпретации плана — его раздел Self-review, зафиксированы для ревью владельцем). Вход для сессии исполнения.
10. `.superpowers/sdd/*/progress.md` — леджеры исполнения срезов (не в git, только на этой машине; `git clean -fdx` уничтожит). Леджеров срезов исключения и OAuth на машине нет — их история: планы + `git log` (исключение `89d887f..c2e60da`, OAuth `44db424..ab973f4`).
11. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы и дизайны прежних срезов читать при разборе истории — их работа в коммитах. Состояние на конец прошлой сессии: `git show 1bb830c:HANDOFF.md`.

## Следующее действие

**Следующий срез — исполнение плана фазы 3, батч A (Tasks 1-3: ajv-formats + SDK 1.6.0), новой сессией** (план `docs/sessions/2026-09-10-rewards-lottery-implementation-plan.md`; правило владельца — батчи по 3 задачи, каждый батч новой сессией; worktree `.worktrees/rewards-lottery`, ветка `rewards-lottery`, леджер `.superpowers/sdd/2026-09-10-rewards-lottery-implementation-plan/progress.md`). **Старт исполнения — после первого живого события** (гейт 2; проектирование завершено: дизайн + план готовы, дальше только реализация). Развилки плана решены владельцем при его написании (2026-09-10): AJV `format: "uuid"` enforcement — подключить `ajv-formats` (Task 1); lint-запрет `Math.random` в `packages/app-*` — включён (Task 11). Интерпретации плана (10 пунктов) — в его разделе Self-review, к ревью владельцем при старте батча A. **Manual smoke OAuth с реальными Google-кредами** перед первым живым событием — действие владельца. **Push на origin — решение владельца** (main впереди origin на 4 коммита). Гейты над фазами — см. раздел ниже.

**Остаточные риски, принятые мерджем (realtime-срез):**
- **Duplicate-acceptance в subscribe** (осознанный trade-off дизайна §4): join каналов — ДО чтения лога, поэтому событие, закоммиченное между join и чтением, придёт и live, и в snapshot. Клиент без seq/cursor (REQ-RT-011a) дедуплицировать не может — принято для MVP; ссылка для фазовой работы над курсором (ф.4).
- **Deferred-миноры финального ревью (ride, триаж «не гейтят»):** M-2 — мёртвая инжекция `config` в RealtimeGateway (убрать при следующем касании); M-4 — cross-socket timing в live-visibility e2e (микроскопическое окно флейка; маркер на organizer-сокете сделает детерминированным); M-5 — `asLogEvent` fallback fail-open (`?? row.visibility`) — fail-closed throw при следующем расширении enum EventVisibility. (M-3 — stale registry entry — **закрыт срезом исключения**, `74035f9`.)
- Риски прошлых срезов (refresh-ротация strict, access-токены ≤15 мин после терминации, `/health/ready` 503) неизменны — `git show 3d7de83:HANDOFF.md`.

**Санкционированные отклонения Quiz-среза** (все прошли ревью, полный журнал — леджер `.superpowers/sdd/2026-09-09-quiz-implementation-plan/progress.md` и §4 exit-аудита ф.2):
1. **Ruling pre-flight:** плотность seq ассертится относительно baseline (lifecycle-события уже в логе), не абсолютных 1..20.
2. **T5:** `describe('AppRegistryModule')` переведён на `register([])` — статический импорт стал fail-closed.
3. **T7:** `AppRuntimeModule.register` получил `imports: [PrismaModule, MembershipModule, RealtimeModule]` — без них Nest DI не разрешает deps AppRuntimeService (int-spec строил сервис вручную, минуя контейнер).
4. **T8:** гард лимита участников обёрнут `if (role !== 'spectator')` — count-запрос (PARTICIPANT) не тронут, прочие гейты (exclusion по IP, rate-limit) сохранены.
5. **T9 (ruling, erratum):** wire-имена событий квиза — dotted-lowercase (`question.opened`, `answer.submitted`, `question.closed`, `game.finish`, `answer.accepted`, `question.revealed`, `game.finished`) под существующую `shortEventNameSchema`; ослабление схемы отклонено (blast radius на все приложения, REQ-CTR-008). TS-идентификаторы `*Payload` остались camelCase.
6. **T10:** `reduceQuiz` игнорирует `payload.totals`, перестраивает totals из `awarded` — проекция не доверяет производным данным payload (запинено тестом с заведомо неверным totals).
7. **T11 (fix round 1):** standings — плотный ранг (1,2,2,3), не competition ranking; различающий тест {100,50,50,30}.
8. **T13:** e2e без override'ов `APP_MANIFESTS`/`APP_RUNTIME_MODULES` — под тестом фактический composition root (сильнее буквы плана); локальная копия `readRoomLog` в спеке (barrel ядра его не экспортирует — утверждение плана устарело); противоречие плана о standings/total 0 разрешено в пользу сценария 1 (totals только из awarded — гость, не отвечавший ни разу, в standings не попадает).

**Опыт Quiz-среза для следующих:**
- **jest testPathPattern матчит ПУТЬ, включая имя worktree** — `.worktrees/quiz/` в пути делает `-- quiz` матчем ВСЕХ e2e-сьютов (каждый прогон = полная лана ~10 с/сьюта). Для точечного прогона использовать уникальное имя файла (`-- quiz.e2e`).
- **Live-кадр может прийти раньше ack publish** (fan-out синхронен с коммитом) — waiters навешивать ДО триггерящего publish, иначе тест повиснет на flush (прецедент: сценарий 1 quiz.e2e, таймаут 180 с).
- **Сырой `$queryRaw` лога отдаёт visibility lowercase** (`'public'`), не Prisma-имя — фильтры по логу в e2e учитывают (та же ловушка, что asLogEvent в realtime-срезе).
- **e2e на проводе снова поймал то, что unit не видел** — порядок «waiter до publish»; DI-разрешение модулей (`imports` в register) видно только через реальный контейнер.
- **Финальное ревью подтвердило:** REQ-RT-007 (payload-нейтральность) на app-пути покрыт `app-runtime.int-spec.ts` тестом 8 (20 конкурентных dispatch, чередование 0/4KB, seq плотные baseline..+39).

**Швы Quiz-среза для будущих планов:**
- **Рантайм-контракт app-модуля (SDK 1.5.0):** `AppRuntimeModule` (manifest + reduce + handlePublish), `AppCommit`, `AppHostContext` (actorId, now ISO, roomId), `AppRejection` — единственный путь механики к логу; отказ модуля — типизированный код из `CONTRACT_ERROR_CODES`, до коммита.
- **Диспетчер `AppRuntimeService`:** гейты до вызова модуля (room ACTIVE → пин `(appId, manifestVersion)` → membership → SPECTATOR → clientInitiated → owner-схема payload), коммит пакетом событий одной транзакцией через `outbox.run`; per-room сериализация `RoomSerializer` (FIFO, identity-checked cleanup); проекция — `AppProjectionCache` + replay из лога, `invalidateProjection(roomId)` для пересоздания.
- **Связывание модулей — только в composition root** (`apps/server/src/app.module.ts`): `AppRegistryModule.register([...])`, `AppRuntimeModule.register([...])`, оба global (шов Task 5/7).
- **Имена событий app-модулей — dotted-lowercase** (`shortEventNameSchema`), полный wire-тип `<appId>.<shortName>`.
- **SPECTATOR (REQ-ID-011):** wire lowercase `spectator` ↔ Prisma `SPECTATOR` в одной точке membership; зритель вне лимита участников; publish зрителю → `PUBLISH_FORBIDDEN` на гейте диспетчера.
- **`correctAnswers` module-private без аннотации** — fail-safe по умолчанию (REQ-CORE-008); чит-тест ф.2 подтвердил: недоступно ни по одному каналу, включая организатора и replay.

**Follow-up пакеты, подбираемые будущими планами явно:**
- **Кандидат на решение владельца (из финального ревью ф.2):** AJV warning `unknown format "uuid" ignored` — zod v4 эмитит `format: "uuid"`, stock Ajv 8 без ajv-formats его не принуждает. Для квиза безопасно (uuid-поля только в server-generated событиях); если норма требует enforcement формата на commit-гейте — отдельная задача (ajv-formats или осознанный waiver).
- **Косметика Quiz-среза (deferred minors, триаж «не гейтят»; полный список — леджер):** неограниченный рост `AppProjectionCache` (per-room записи без эвикции — фаза 4); clamp-ветка скоринга `Math.max(base−k·step,0)` без отдельного теста (провод защищён `points.min(0)`); quiz.e2e-spec.ts:379 мёртвый push closed-ack после проверочного цикла чит-теста; неотписанные live-listeners в чит-тесте; optionIndex-absence в `answer.accepted` проверен по одной ленте из четырёх; устаревший комментарий `realtime.e2e-spec.ts:89-90`; негативный кейс correctIndex неверного типа; литеральная роль `'participant'|'spectator'` в сигнатуре join (кандидат `JoinRequest['role']`); неограниченный рост spectators (кандидат формулировки при ревизии спеки).
- **Чистка invalid-uuid литералов** в старых int-спеках + fail-closed в `asLogEvent` (M-5) + удаление мёртвой инжекции config (M-2) — пакет косметики realtime.
- **Для следующего среза, трогающего configure/app-registry** (из финального ревью appSettings): guard `settings === undefined|null` → `AppSettingsInvalidError`; `ValidateFunction` из `ajv/dist/2020`; race-тест configure-vs-activate с quiz@2; контрактное допущение «settings — не-null JSON value».
- **Для web-client-среза:** CORS без `credentials: true` + SameSite=Strict — клиент с другого origin не сможет использовать refresh-куку (сейчас корректно для same-origin).
- Негативные strictObject-кейсы для ack-схем SDK (минор Task 2); экспорт realtime-фикстур из SDK index — при первом внешнем потребителе.
- Из membership/guest-join: гонка soft-delete/status-flip в `MembershipService.join` — принятый класс гонки (design fork (б)); JSDoc на `RoomService.create` про lowercase-in/Prisma-name-out.
- Deferred-миноры event-commit (ride): `eventValidatorFor` игнорирует schema-аргумент на cache-hit; некомпилируемая app-схема падает лениво (кандидат boot-time compile-check в app-registration срез); точки ручного конструирования `EventLogService` в спеках дрейфуют (кандидат — test-module builder).

## Два гейта над фазами

1. **Юрист** — до первого события с посторонними или призами. Список вопросов готов (`docs/legal/questions-for-lawyer.md`). Блокирует старт работы с реальными PII, не блокирует реализацию.
2. **Первое живое событие** — до тяжёлых вложений в фазу 3 (rewards/лотерея).

## Долгоживущие ограничения, введённые срезами

- **Замороженные миграции:** `20260718061612_room_lifecycle`, `20260722151900_identity_seam`, `20260722153952_room_organizer_fk`, `20260722180147_realtime_log_event`, `20260723090841_room_app_config`, `20260729164500_membership_guest_join`, `20260730101037_auth_sessions`, `20260819154552_membership_exclusion`, `20260902191322_oauth_identity_provider`. Любое изменение — только новой миграцией. (Quiz-срез схему БД не трогал — состояние модуля живёт в логе событий.)
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
- **Инвариант «change both or neither» (ТРИ места):** предикат `kind = 'REGISTERED' AND deletedAt IS NULL` живёт в частичном индексе `"Identity_registered_email_key"`, guarded INSERT в `RoomService.create` и пречеке конфликта в `IdentityService.findOrCreateByProvider`. Менять только вместе. (Комментарий в `room.service.ts:82-83` всё ещё говорит «два места» — известный дрейф, поправить при следующем касании.)
- **Хост-порты 5432 и 55432:** контейнеры `lt-pg`/`lt-pg-sdd` (не проектные) были удалены 2026-09-03 рестартом OrbStack и не восстановлены — перед публикацией authoring-контейнера проверять `docker ps`.
- **Testcontainers v12 + OrbStack — две ловушки restart'а контейнера:** (1) у Started-контейнера нет `start()`, stop/start идут через `getContainerRuntimeClient()` (`client.container.stop/start(getById(id))`); (2) **OrbStack переназначает случайный host-порт при restart** — старый пул мёртв навсегда, клиент пересоздаётся на фактический порт из `inspect`. Оба приёма зашиты в харнесс (`stopContainer`/`startContainer`, последний возвращает новый `PrismaService`).
- **`prisma migrate dev` не всегда регенерирует клиент; явный `pnpm exec prisma generate` требует DATABASE_URL** и cwd = корень репозитория. Prisma 7 CLI работает только из корня репо (`prisma.config.ts` там): форма `pnpm --filter @mymozhem/core exec prisma …` падает — использовать `pnpm exec prisma …` из корня.
- **`packages/core/src/testing/postgres.testcontainer.ts` — переиспользуемый паттерн ядра.** Мутирует глобальный `process.env.DATABASE_URL` без восстановления (безопасно только при `maxWorkers: 1`); требует cwd = корень репозитория. Несёт `stopContainer`/`startContainer` для тестов недоступности БД (REQ-DEV-008, `db-down.int-spec.ts`).
- **`ReplyLike` — адаптер fastify 5:** сигнатуры сверять с fastify 5 (`redirect(url, code?)`, code дефолт 302). OAuth-куки (`mm_oauth_*`) — `SameSite=Lax` осознанно (возврат с Google — top-level GET), path `/auth`, TTL `OAUTH_STATE_TTL`; refresh-кука остаётся `Strict`. Гостевой cap refresh — ТОЛЬКО в точках выдачи (`TokenService.sessionExpiry` ⇄ `setRefreshCookie` — «одна норма в двух местах», менять вместе); конфиг-инварианта `REFRESH ≤ GUEST_TTL` больше нет.
- **Прогон интеграционной ланы поднимает контейнеры Postgres** (~8 с локально на файл). Docker Desktop/OrbStack должен быть запущен.
- **Jest CLI:** форма `pnpm --filter @mymozhem/core test:int -- -t "..."` миспарсится — рабочая форма без `--`. Фильтр всегда проверять на >0 матчей. В worktree с говорящим именем testPathPattern матчит путь целиком (см. опыт Quiz-среза).
- **apps/server e2e резолвит `@mymozhem/core` из dist** — перед `pnpm --filter @mymozhem/server test` обязателен `pnpm build`; core резолвит `@mymozhem/sdk` из dist — после правок SDK `pnpm --filter @mymozhem/sdk build`; то же для `@mymozhem/app-quiz` (server e2e тянет его dist).
- **Граница app-модулей (Quiz-срез):** `packages/app-*` НЕ импортирует `packages/core` (boundary `app-only-through-sdk`, правило покрывает `packages/app-` generically); `@mymozhem/sdk` — лист. Связывание — только `apps/server` (composition root).

## Отложенные follow-up (не гейтят; полный список с обоснованиями — в леджерах)

- **OAuth-срез (триаж финального ревью — все follow-up):** unit на `setRefreshCookie` (maxAge-тернарник покрыт только зеркально); `createRoomResponseSchema.parse` на границе POST /rooms (сейчас echo-инвариант на контракте сервиса); deletedAt-гард в P2002 winner-ветке `findOrCreateByProvider`; cross-account email-гонка → raw P2002 → 400 вместо OAUTH_EMAIL_CONFLICT (различать индекс по `err.meta.target` — дизайн-решение); очистка oauth-кук при rate-limit/zod-отказах callback (сейчас живут до TTL ≤ 600 с — не ослабление, сознательно); поправить комментарий «два места» в `room.service.ts`; опечатка REQ-ID-015→REQ-ID-005 в комментарии `ROOM_ORGANIZER_NOT_REGISTERED` (sdk error-codes); непокрытые мелочи тестов: Max-Age/Secure oauth-кук, start-лимитер, точный статус /rooms/join в REQ-SEC-006 батарее; `oauthCallbackQuerySchema` strict — лишний query-параметр (utm_*) даст 400, помнить при web-client-срезе.

- **Вынести testing-экспорты из prod-баррела core** в отдельный entry point — при этом починить `create-room.mjs` обратно на баррел (его dist-subpath-импорты молча сломаются при появлении `exports` в core). После realtime-среза скрипт дополнительно конструирует RealtimeBus/EventOutbox.
- **`create-room.mjs`: findFirst по точному `email`, а индекс — по `lower(email)`** — при кейс-варианте будет сырая unique-violation вместо reuse.
- **`updateManyAndReturn` доступен на Prisma 7.8.0** — схлопнет 3 запроса в 2 в мутациях `RoomService` (transition/softDelete/configure). **Осторожно:** transition теперь работает внутри `outbox.run` с staging — рефакторинг не должен разорвать атомарность «UPDATE + лог + staged-доставка».
- **Нет гейта на дрейф миграций** (`prisma migrate diff --from-migrations` непригоден без `datasource.shadowDatabaseUrl` в `prisma.config.ts`).
- **Общая рекурсивная `jsonValueSchema`** для payload в `log-event`/`projected-event` — `z.record(z.string(), z.unknown())` не принуждает структурно REQ-CTR-002.
- Косметика: breadcrumb в `schema.prisma` о рукописном CHECK; ассерт ортогональности soft-delete только для CANCELLED.

## Осталось недоделанным

- **Следующий срез — батч A плана ф.3 (Tasks 1-3), новой сессией** (см. «Следующее действие»; гейт 2 «первое живое событие» открыт — старт исполнения после события, решение владельца). **Manual smoke OAuth с реальными Google-кредами** перед первым живым событием — действие владельца. **Push на origin** — решение владельца (main впереди origin на 4 коммита).
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.

## Session 2026-09-10 (девятая: план реализации фазы 3 написан)

*(Блок восьмой сессии (дизайн фазы 3, утверждение по секциям) вырезан — работа в коммитах; восстановимо через `git show 922fe2c:HANDOFF.md`.)*

### Что сделано

- **План реализации фазы 3 написан по superpowers:writing-plans** — `docs/sessions/2026-09-10-rewards-lottery-implementation-plan.md` (3129 строк, 13 задач, батчи A–E по правилу «3 задачи = новая сессия»): A — SDK-дельта 1.6.0 (ajv-formats, capabilities, AppEffect/AppPublishResult, хост-примитивы, REWARDS_EVENTS, REST DTO); B — rewards в ядре (миграция с CHECK + частичным индексом, RewardsService, REST); C — app-runtime (исполнение эффектов, capability-гейт, drawPool) + TTL-свип + app-lottery; D — квиз v2 + composition root + boundary/lint-принуждение; E — e2e квиз-начислений + сверка критериев выхода.
- **Решения владельца по развилкам дизайна §8** (AskUserQuestion при написании плана): AJV `format: "uuid"` enforcement — подключить `ajv-formats` на commit-гейте (Task 1, waiver отклонён); lint-запрет `Math.random` в `packages/app-*` — включён задачей (Task 11).
- **Self-review плана пройден** (покрытие дизайна §1–§8, скан плейсхолдеров, консистентность типов — поймана и исправлена одна: сигнатура `executeEffects` несёт `sourceAppId`, диспетчер передаёт appId пиннутого модуля). 10 интерпретаций плана зафиксированы в его разделе Self-review — к ревью владельцем при старте батча A.
- Исследование швов делегировано двум Explore-агентам (SDK+quiz; ядро) — точные сигнатуры и номера строк вшиты в план; ключевые факты сверены прямыми чтениями (CORE_EVENTS, AppRegistryService/Ajv, HttpExceptionFilter, e2e-хелперы).

### Коммиты этой сессии

- `9d45fe2` docs(plan): план реализации фазы 3 (Rewards + Lottery + TTL-свип + квиз-начисления) — 13 задач, 5 батчей; решены развилки ajv-formats и lint Math.random

### Локальное состояние (не в git)

- Ничего не запущено; конвейер не запускался (сессия без кода). Side-effects на внешние системы: нет. Push не выполнялся — решение владельца (main впереди origin на 4 коммита).

### Осталось недоделанным

- См. одноимённый раздел выше (батч A новой сессией после гейта 2; ревью интерпретаций плана владельцем; manual smoke OAuth; юрист; push).
