# HANDOFF

**Date:** 2026-07-23
**Branch:** `main` (рабочее дерево чистое; **3 коммита впереди `origin/main`, не запушено** — дизайн + план appSettings-среза + это handoff-обновление) — последний контентный коммит `a343fe1` docs(plan): appSettings write path implementation plan (2026-07-23).

**Состояние фазы 1.** SDK contract core, сервис регистрации манифеста, Room lifecycle, Identity minimal seam (REQ-ID-001 + REQ-ID-005) и Lifecycle-эмит в лог (REQ-RT-010 2/3, REQ-RT-001, REQ-RT-007, REQ-DEV-008) — завершены и слиты в `main`. Следующий срез — **appSettings write path (REQ-RT-004, REQ-CORE-007, REQ-RT-010→3/3)** — **спроектирован и запланирован**: дизайн одобрен владельцем, план написан с self-review, оба закоммичены. **Исполнение целиком впереди** (решение владельца: subagent-driven-development в новой сессии). Этап продукта — MVP. Метод — AIDD / Specification-Driven.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. **`.superpowers/sdd/progress.md` — леджер исполнения планов** (SDK + app-registry + Room lifecycle + identity + lifecycle-emit). Читать после CLAUDE.md. Задачи COMPLETE — сделаны, не пере-диспатчить. Леджера нет в git (`.superpowers/` игнорируется) — он существует только на этой машине.
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `docs/sessions/2026-07-23-appsettings-write-path-design.md` — **одобренный дизайн текущего среза**; §0 — пять решений владельца, §5 — порядок активации с post-lock re-read, §9 — таблица швов.
6. `docs/sessions/2026-07-23-appsettings-write-path-implementation-plan.md` — **план исполнения (5 задач)** — вход для subagent-driven-development.
7. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы (sdk-contract-core, app-registry, room-lifecycle, identity-minimal-seam, realtime-log-lifecycle-emit, их дизайн-доки) читать только при разборе истории — их работа в коммитах.

## Следующее действие

**Исполнить план appSettings write path через subagent-driven-development (новая сессия).** План: `docs/sessions/2026-07-23-appsettings-write-path-implementation-plan.md`, 5 задач:

1. Миграция: колонки `(appId, manifestVersion, appSettings)` на `room."Room"` + рукописный CHECK `Room_config_triple` (+ DB-уровневые тесты инварианта).
2. `AppRegistryService.validateSettings`: ajv (draft 2020-12, `import Ajv2020 from 'ajv/dist/2020'` — НЕ дефолтный Ajv), ленивый кэш, семейство `AppRegistryError` (unit).
3. `RoomService.configure`: guarded UPDATE DRAFT-only, `ROOM_SETTINGS_FROZEN`, wiring `RoomModule → AppRegistryModule` (интеграционные).
4. Активация: предусловие `ROOM_NOT_CONFIGURED`, перевалидация, эмит `room.activated` с пином; обновление регрессионного якоря лога (1 строка → 2); race-тест configure-vs-activate (интеграционные).
5. Полные гейты + живой boot с 5 миграциями.

Ключевые точки для исполнителя:
- **Порядок активации — post-lock re-read** (дизайн §5, поправлено при планировании): guarded UPDATE (row-lock, точка сериализации с configure) → re-read → предусловие + перевалидация → эмит. Чтение пина из до-lock снапшота отдавало бы в событие старый пин при гонке.
- **Конструктор RoomService становится трёхаргументным** (Task 3) — план обновляет все 5 мест в int-spec через хелпер `makeService`.
- Существующие тесты, вызывающие `activate` без конфигурации, сломаются в Task 4 — план их обновляет (configure перед activate).
- Комментарий-шов о конвенции порядка блокировок в `event-log.service.ts` так и не добавлен (этот срез файл не трогает) — остаётся ближайшему срезу, который его тронет, без отдельного коммита.

Со среза identity есть пакет follow-up для **первого реального identity-пишущего потока** (guest-join / OAuth), подобрать его планом явно:
- presence-тест индекса: ассертить `UNIQUE` и колонку в indexdef (сейчас ловят только поведенческие тесты);
- кросс-kind кейс индекса: GUEST с email живого REGISTERED — разрешён;
- malformed non-UUID `organizerId` → сейчас сырой Postgres uuid-syntax error; маппинг в типизированную ошибку — на boundary-слое первого транспорта (REQ-SEC-006);
- косметика: `harness.int-spec.ts` сидит identity без email; устаревший комментарий в `jest.integration.config.js` («per file» → «per describe»).

**Forward-обязательство** (не забыть при первом же выходе наружу): первый потребитель, отдающий `ContractError`/доменную ошибку по HTTP/Socket.io, обязан идти через типизированный код без стектрейса, не `err.message` (REQ-SEC-006). Room-ошибки (`ROOM_TRANSITION_INVALID`, `ROOM_CONFLICT`, `ROOM_ORGANIZER_NOT_REGISTERED`) сейчас core-внутренние и границу не пересекают. AppSettings-срез добавляет `APP_MANIFEST_UNKNOWN`, `APP_SETTINGS_INVALID`, `ROOM_NOT_CONFIGURED`, `ROOM_SETTINGS_FROZEN` — то же правило; `ROOM_SETTINGS_FROZEN` намеренно совпадает строкой с зарезервированным кодом SDK-контракта (маппинг 1:1).

## Два гейта над фазами

1. **Юрист** — до первого события с посторонними или призами. Список вопросов готов (`docs/legal/questions-for-lawyer.md`). Блокирует старт работы с реальными PII, не блокирует реализацию.
2. **Первое живое событие** — до тяжёлых вложений в фазу 3 (rewards/лотерея).

## Долгоживущие ограничения, введённые срезами

- **Замороженные миграции:** `20260718061612_room_lifecycle`, `20260722151900_identity_seam`, `20260722153952_room_organizer_fk`, `20260722180147_realtime_log_event`. Любое изменение — только новой миграцией. Миграция appSettings-среза (`<timestamp>_room_app_config`) замораживается после слияния — внести сюда на закрытии среза.
- **Конвенция порядка блокировок (из финального ревью lifecycle-эмита):** advisory lock комнаты — всегда leaf-most; транзакция, захватившая его, не должна после этого писать в `room."Room"` (сейчас порядок везде безопасен: `transition` берёт row-lock до advisory lock, `commitCoreEvent` не трогает Room). Будущие пути эмита обязаны его сохранять.
- **Prisma 7.8 adapter-pg ловушка:** `$queryRaw` не десериализует `void`-возвращающие выражения (`pg_advisory_xact_lock`) — использовать `$executeRaw`. Учитывать при написании будущих планов.
- **Инвариант «change both or neither»:** предикат `kind = 'REGISTERED' AND deletedAt IS NULL` живёт в двух местах — частичный индекс `"Identity_registered_email_key"` (миграция identity_seam) и guarded INSERT в `RoomService.create`. Менять только вместе (design §7).
- **Хост-порт 5432 занят чужим контейнером `lt-pg`** (не проектным, не трогать). Authoring-контейнер миграций (`mm-migrate`, эфемерный) публиковать на свободный порт (в срезах identity/lifecycle-emit использовались 55432/55433) и подставлять его в `DATABASE_URL`.
- **`prisma migrate dev` не всегда регенерирует клиент; явный `pnpm exec prisma generate` требует DATABASE_URL** и cwd = корень репозитория (обнаружение `prisma.config.ts`).
- **`packages/core/src/testing/postgres.testcontainer.ts` — переиспользуемый паттерн ядра.** Все будущие DB-тесты пойдут через него, поэтому его острые углы наследуются: он мутирует глобальный `process.env.DATABASE_URL` и не восстанавливает его (безопасно только при `maxWorkers: 1`), и требует cwd = корень репозитория для обнаружения `prisma.config.ts`.
- **Прогон интеграционной ланы поднимает контейнеры Postgres** (по одному на describe с `startTestDb`; ~8 с локально на файл, дольше на холодном CI-раннере). Docker Desktop должен быть запущен.

## Отложенные follow-up (не гейтят; полный список с обоснованиями — в леджере)

Самое ценное из накопленного:

- **`updateManyAndReturn` доступен на закреплённой Prisma 7.8.0** — схлопнет 3 запроса в 2 в обеих мутациях `RoomService` (transition/softDelete) и попутно уберёт дублирование хвоста `if (count===0) throw` + re-read. Проверено ревьюером, не гипотеза. **Осторожно:** после среза lifecycle-эмита `transition` — транзакция с побочным эмитом; применение updateManyAndReturn не должно разорвать атомарность «UPDATE + лог». После appSettings-среза в transition добавился ещё и post-lock re-read — его роль (консистентный снаптор пина) не спутать с рефакторингом.
- **Нет гейта на дрейф миграций.** `prisma migrate diff --from-migrations` здесь непригоден: Prisma 7.8 требует `datasource.shadowDatabaseUrl` в `prisma.config.ts`, которого нет. Стоит завести настоящий гейт, пока миграций мало.
- **Общая рекурсивная `jsonValueSchema`** для payload в `log-event`/`projected-event` — `z.record(z.string(), z.unknown())` не принуждает структурно REQ-CTR-002.
- **Комментарий-шов о конвенции порядка блокировок в `event-log.service.ts`** (advisory lock — всегда leaf-most) — добавить в ближайшем срезе, трогающем файл, без отдельного коммита.
- Косметика: breadcrumb в `schema.prisma` о существовании рукописного CHECK; ассерт ортогональности soft-delete добавлен только для ветки CANCELLED (из трёх удаляемых статусов).

## Осталось недоделанным

- **3 коммита не запушены** (дизайн + план appSettings-среза + handoff-обновление). Публикация — решение владельца. CI видел identity/lifecycle-emit коммиты (запушены 2026-07-22), коммиты этой сессии — ещё нет.
- **Исполнение плана appSettings write path** — целиком впереди (5 задач, новая сессия, subagent-driven) — см. «Следующее действие».
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.

## Session 2026-07-23 (brainstorm → plan среза appSettings write path)

### Что сделано

- **Запушены 14 коммитов** в `origin/main` (identity-срез + lifecycle-emit срез) — решение владельца в начале сессии.
- Пройден полный цикл superpowers:brainstorming → дизайн → superpowers:writing-plans для среза **appSettings write path (REQ-RT-004, REQ-CORE-007, REQ-RT-010→3/3)**. Дизайн одобрен владельцем по секциям, план написан с self-review; оба закоммичены.
- **Пять решений владельца на brainstorm** (зафиксированы в дизайне §0):
  1. Границы среза — доменный сервис, без HTTP (REST + маппинг ошибок — план с auth; actorId — туда же; проекции appSettings — realtime read план).
  2. `manifestVersion` выбирается явно при записи конфигурации, не резолвится в «latest» при активации.
  3. Активация без конфигурации — отказ (`ROOM_NOT_CONFIGURED`); ослабление контракта события отклонено.
  4. Движок валидации JSON Schema — **ajv** (только в `packages/core`), дом валидатора — модуль app-registry (`AppRegistryService.validateSettings`).
  5. Write-API — один атомарный `configure` с полной заменой тройки `(appId, manifestVersion, appSettings)`.
- **Ключевые находки контекста:** SDK-контракт уже резервировал код `ROOM_SETTINGS_FROZEN` (используем ту же строку в `ROOM_ERROR_CODES`, SDK не меняем); манифестные схемы несут `$schema` draft 2020-12 → нужен `Ajv2020`, не дефолтный Ajv; существующие тесты активации без конфигурации сломаются — план их обновляет.
- **Поправка дизайна при планировании** (внесена в дизайн §5 и закоммичена с планом): порядок активации — guarded UPDATE (row-lock) → re-read → предусловие + перевалидация → эмит. Исходный псевдокод брал пин из до-lock снапшота — гонка с configure давала бы событию старый пин.
- Решение об исполнении: **subagent-driven-development в новой сессии** (как предыдущие срезы).

### Коммиты этой сессии

- `de0fd8f` docs(design): appSettings write path slice design (REQ-RT-004, REQ-CORE-007, REQ-RT-010)
- `a343fe1` docs(plan): appSettings write path implementation plan (REQ-RT-004, REQ-CORE-007, REQ-RT-010)

### Локальное состояние (не в git)

- Docker Desktop запущен; `lt-pg` на 5432 нетронут; authoring/compose-контейнеров сейчас нет (план Task 1 создаст `mm-migrate` на 55432).
- `.superpowers/sdd/` — леджер (`progress.md`) с полной историей срезов. Не отслеживается git; `git clean -fdx` уничтожит.
- Внешние системы: push в origin/main (14 коммитов) — единственный side-effect; тестовые прогоны в этой сессии не запускались (только чтение кода/доков).

### Осталось недоделанным

- Исполнение плана appSettings write path — целиком впереди (5 задач, новая сессия, subagent-driven).
- Пуш 3 коммитов — решение владельца.
