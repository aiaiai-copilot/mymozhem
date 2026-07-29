# HANDOFF

**Date:** 2026-07-29 (ночь, membership/guest-join СЛИТ в main)
**Branch:** `main` (17 коммитов впереди `origin/main`, последний `408a463` — merge среза; **push — решение владельца**; untracked `AGENTS.md` — не сессионный, не трогать).

**Состояние фазы 1.** SDK contract core, сервис регистрации манифеста, Room lifecycle, Identity minimal seam, Lifecycle-эмит в лог, appSettings write path — завершены и слиты в `main`. Срез **Membership / guest-join** (REQ-ID-002/003/006/011/013, REQ-OPS-003) — **COMPLETE и СЛИТ в `main`** (`408a463`, `--no-ff`): план исполнен subagent-driven целиком (Tasks 1–6 в трёх батчах), финальное whole-branch ревью пройдено («Ready to merge: With fixes» → fix `107e12d`, re-review ALL ADDRESSED), тесты/typecheck на слитом результате зелёные, feature-ветка удалена. Этап продукта — MVP. Метод — AIDD / Specification-Driven.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. **`.superpowers/sdd/2026-07-29-membership-guest-join-implementation-plan/progress.md` — леджер завершённого среза.** Все 6 tasks COMPLETE, финальное ревью пройдено — план НЕ переисполнять. Резюм: мердж ветки. (Старый леджер прежних срезов — `.superpowers/sdd/progress.md`.) Леджер не в git (`.superpowers/` игнорируется) — существует только на этой машине; `git clean -fdx` уничтожит.
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `docs/sessions/2026-07-23-appsettings-write-path-design.md` — образец свежего дизайна среза (§0 — решения владельца, §5 — post-lock re-read, §9 — швы).
6. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы (sdk-contract-core, app-registry, room-lifecycle, identity-minimal-seam, realtime-log-lifecycle-emit, appsettings-write-path, их дизайн-доки) читать только при разборе истории — их работа в коммитах.

## Следующее действие

**Выбор следующего среза фазы 1** (brainstorm → дизайн → план, как прежние срезы). Кандидаты из follow-up пакетов ниже; наиболее созревший — **транспортный срез с auth/HTTP**: он подбирает REQ-SEC-006 forward-обязательство (типизированные коды без стектрейсов наружу), parked-minors среза membership/guest-join (eviction лимитера, real-IP) и открывает путь к первому живому событию. Перед ним — напомнить владельцу про **push** (`main` на 17 коммитов впереди `origin/main`).

**Follow-up пакеты, подбираемые будущими планами явно:**

**Для следующего среза, трогающего configure/app-registry** (из финального ревью appSettings, ~15 строк суммарно):
- guard в `configure` на `settings === undefined || settings === null` → `AppSettingsInvalidError` (сейчас: permissive-схема + null даёт сырую P2011 от CHECK, а re-configure с `undefined` молча оставляет stale settings под новым пином; гейт активации ловит до эмита, но отказ нетипизирован);
- `ValidateFunction` импортировать из `ajv/dist/2020`, а не из `ajv` (type-only косметика);
- race-тест configure-vs-activate со второй версией манифеста (quiz@2) — сейчас обе стороны гонки пинят quiz@1, и ассерт «пин == строке» проходит тривиально;
- при появлении транспорта: зафиксировать в контрактных доках допущение «settings — не-null JSON value».

**Для первого реального identity-пишущего потока** (guest-join / OAuth), со среза identity — **бóльшая часть подобрана планом membership/guest-join** (presence-тест индекса с UNIQUE+колонкой, кросс-kind кейс, косметика harness'а и jest-конфига — Task 3 плана). Остаётся на транспортный срез:
- malformed non-UUID `organizerId` → сейчас сырой Postgres uuid-syntax error; маппинг в типизированную ошибку — на boundary-слое первого транспорта (REQ-SEC-006);

**Для среза event-commit (из дизайна lifecycle-эмита, §10):** подобрать отложенные тесты actorId≠null и payload-нейтральности гонки за seq.

**Для транспортного среза (guest-join по HTTP/Socket.io), parked из финального ревью membership/guest-join:**
- `JoinRateLimiter` не вытесняет протухшие IP-записи (`join-rate-limiter.ts`) — Map растёт по одной записи на distinct IP за время жизни процесса; fix = `delete` при expiry или периодический sweep; реальный вектор появится с выходом наружу;
- гонка soft-delete/status-flip между проверкой и insert в `MembershipService.join` — тот же класс принятой гонки, что count-then-insert (design fork (б) называет только лимит); acceptance зафиксирован в леджере; направление fail-safe (сиротская membership-строка безвредна, ничего не эмитится);
- real-IP extraction (доверие к X-Forwarded-For) — принадлежит транспорту, лимитер считает по `params.ip` как дано;
- JSDoc на `RoomService.create`: словарь политики lowercase-in (`'registered'`) / Prisma-name-out (`'REGISTERED'`);
- при первом касании `apps/server/test/health.e2e-spec.ts`: placeholder `DATABASE_URL` указывает на 5432 (`lt-pg`) — заменить на мёртвый порт и добавить save/restore env в afterAll.

**Для плана с auth/HTTP:** REST-поверхность + маппинг типизированных ошибок + actorId (швы дизайна appSettings §9). Все новые коды этого среза (`APP_MANIFEST_UNKNOWN`, `APP_SETTINGS_INVALID`, `ROOM_NOT_CONFIGURED`, `ROOM_SETTINGS_FROZEN`) — core-внутренние; `ROOM_SETTINGS_FROZEN` намеренно совпадает строкой с зарезервированным кодом SDK-контракта (маппинг 1:1). Коды membership-среза (`ROOM_JOIN_DENIED`, `JOIN_RATE_LIMITED`, `ROOM_PARTICIPANT_LIMIT_REACHED`) — тоже core-внутренние, маппинг наружу — обязанность этого же транспорта (REQ-SEC-006).

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

- **Push `main`** (17 коммитов впереди `origin/main`) — решение владельца.
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.

## Session 2026-07-29, ночь (батч 3 membership/guest-join + мердж в main)

### Что сделано

- **Task 5 (JoinRateLimiter + MembershipService.join)** — COMPLETE, commit `a123f0d`. Процессный казус: первый implementer-субагент выполнил и закоммитил задачу, но умер на API-таймауте до отчёта; второй implementer верифицировал дословное соответствие брифу и прогнал все гейты (limiter unit 3/3, join int 15/15, unit 83/83, int 78/78). Ревью: spec ✅, Approved, 0 Critical/Important, 2 Minor (roll-up).
- **Task 6 (экспорты, wiring, полные гейты + живой boot)** — COMPLETE, commits `d70f919` (fix: placeholder `DATABASE_URL` в health e2e — ConfigModule валидирует env при boot AppModule, REQ-OPS-003) + `47d7105`. Полная лана из корня зелёная; живой docker boot: `/health/ready` 200, 6 миграций; `down -v`, `lt-pg` не тронут.
- **Финальное whole-branch ревью ветки** (`a6d53b8..47d7105`, opus): «Ready to merge: With fixes» — 0 Critical, 1 Important (`TEST_CONFIG` в трёх int-spec'ах). Fix wave `107e12d` (извлечение в `src/testing/test-config.ts` + единый источник дефолта лимита), scoped re-review: ALL ADDRESSED. Остальные minors — parked с рулингами в леджере; самые ценные перенесены в follow-up пакеты выше (транспортный срез).
- **Мердж в `main`**: `408a463` (`--no-ff`, в стиле репо); тесты/typecheck на слитом результате зелёные (turbo-cache hit — дерево идентично прогнанному); feature-ветка `phase-1-membership-guest-join` удалена.
- Три API-обрыва субагентов за сессию (таймауты/connection closed) — работа восстановлена резюмом агентов или верификацией уже сделанных коммитов; леджер + отчёты оказались достаточны.

### Коммиты этой сессии

- `a123f0d` feat(core): guest join flow with entry limits (REQ-ID-002, REQ-ID-003, REQ-ID-006, REQ-ID-013)
- `d70f919` fix(server): set DATABASE_URL placeholder for AppModule boot in health e2e (REQ-OPS-003)
- `47d7105` feat(core): wire identity/membership modules into the app (REQ-ID-002)
- `107e12d` refactor(core): extract shared TEST_CONFIG into src/testing (REQ-OPS-003)
- `340d7b2` + handoff-коммит этой правки; мердж `408a463`. Всё в `main`, не пушено (push — решение владельца).

### Локальное состояние (не в git)

- Docker Desktop запущен; `lt-pg` на 5432 нетронут; проектных контейнеров нет (boot-смоук завершён `down -v`).
- Untracked `AGENTS.md` в корне — не трогать (вопрос владельцу о его судьбе всё ещё открыт).
- Леджер завершённого среза: `.superpowers/sdd/2026-07-29-membership-guest-join-implementation-plan/progress.md` — оставлен по конвенции репо (прежние леджеры не удалялись); briefs/reports/диффы рядом. `git clean -fdx` уничтожит.
- Внешних side-effects не было (ни push, ни прод-тестов; интеграционная лана — только throwaway testcontainers).

### Осталось недоделанным

- Push `main` (17 коммитов впереди `origin/main`) — решение владельца.
- Выбор следующего среза — brainstorm с владельцем (кандидат — транспортный, см. «Следующее действие»).
- Юрист — гейт 1 открыт, действие вне агента.
