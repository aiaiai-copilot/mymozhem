# HANDOFF

**Date:** 2026-07-22
**Branch:** `main` (рабочее дерево чистое; **14 коммитов впереди `origin/main`, не запушено** — identity-срез + lifecycle-emit срез + merge) — последний контентный коммит `b2cacb7` feat(core): export and register RealtimeModule in server (2026-07-22), merge `--no-ff` поверх него.

**Состояние фазы 1.** SDK contract core, сервис регистрации манифеста, Room lifecycle, Identity minimal seam (REQ-ID-001 + REQ-ID-005) и **Lifecycle-эмит в лог (REQ-RT-010 2/3, REQ-RT-001, REQ-RT-007, REQ-DEV-008)** — завершены и слиты в `main`. Event Log построен с нуля: таблица `realtime."LogEvent"`, примитив `EventLogService.commitCoreEvent` (валидация payload до advisory-lock, атомарный seq), `RoomService.transition` эмитит `room.completed`/`room.cancelled` в одной транзакции с переходом. Следующий срез — **appSettings write path (REQ-RT-004)**: он же закроет эмит `room.activated` (шов, дизайн §0 п.1) и тем самым REQ-RT-010 полностью. Этап продукта — MVP. Метод — AIDD / Specification-Driven.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. **`.superpowers/sdd/progress.md` — леджер исполнения планов** (SDK + app-registry + Room lifecycle + identity). Читать после CLAUDE.md. Задачи COMPLETE — сделаны, не пере-диспатчить. Леджера нет в git (`.superpowers/` игнорируется) — он существует только на этой машине.
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `docs/sessions/2026-07-22-realtime-log-lifecycle-emit-design.md` — **одобренный дизайн текущего среза**; §0 — два решения владельца (activated-эмит → appSettings-срез; лог в модуле/схеме `realtime`), §10 — таблица швов.
6. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы (`2026-07-16-sdk-contract-core`, `2026-07-18-app-registry-registration`, `2026-07-18-room-lifecycle`, `2026-07-22-identity-minimal-seam`, их дизайн-доки) читать только при разборе истории — их работа в коммитах.

## Следующее действие

**Следующий срез фазы 1 — appSettings write path (REQ-RT-004).** Он разблокирован и является единственным оставшимся кандидатом из пары HANDOFF'а; закрывает эмит `room.activated` (payload = пин `(appId, manifestVersion)`, шов дизайна lifecycle-эмита §0 п.1, §10) и тем самым доводит REQ-RT-010 до полного закрытия. Процесс как обычно: brainstorm → дизайн (в `docs/sessions/`) → план → subagent-driven-development.

Точки входа в новый срез (из финального ревью lifecycle-эмита):
- эмит активации встаёт в `LIFECYCLE_EVENTS` в `RoomService.transition` (комментарий-шов уже на месте); тест DRAFT→ACTIVE→COMPLETED «ровно одна строка в логе» — регрессионный якорь, обновить на две строки с пином;
- добавить однострочный комментарий о конвенции порядка блокировок в `event-log.service.ts` (advisory lock — всегда leaf-most; после его захвата не трогать `room."Room"` в той же транзакции) — в ближайшем срезе, который трогает этот файл, без отдельного коммита.

Со среза identity есть пакет follow-up для **первого реального identity-пишущего потока** (guest-join / OAuth), подобрать его планом явно:
- presence-тест индекса: ассертить `UNIQUE` и колонку в indexdef (сейчас ловят только поведенческие тесты);
- кросс-kind кейс индекса: GUEST с email живого REGISTERED — разрешён;
- malformed non-UUID `organizerId` → сейчас сырой Postgres uuid-syntax error; маппинг в типизированную ошибку — на boundary-слое первого транспорта (REQ-SEC-006);
- косметика: `harness.int-spec.ts` сидит identity без email; устаревший комментарий в `jest.integration.config.js` («per file» → «per describe»).

**Forward-обязательство** (не забыть при первом же выходе наружу): первый потребитель, отдающий `ContractError`/доменную ошибку по HTTP/Socket.io, обязан идти через типизированный код без стектрейса, не `err.message` (REQ-SEC-006). Room-ошибки (`ROOM_TRANSITION_INVALID`, `ROOM_CONFLICT`, `ROOM_ORGANIZER_NOT_REGISTERED`) сейчас core-внутренние и границу не пересекают. Lifecycle-эмит добавляет `ContractError('EVENT_PAYLOAD_INVALID')` в commit-примитиве — по факту недостижим (payload конструирует ядро), но при выходе наружу действует то же правило.

## Два гейта над фазами

1. **Юрист** — до первого события с посторонними или призами. Список вопросов готов (`docs/legal/questions-for-lawyer.md`). Блокирует старт работы с реальными PII, не блокирует реализацию.
2. **Первое живое событие** — до тяжёлых вложений в фазу 3 (rewards/лотерея).

## Долгоживущие ограничения, введённые срезами

- **Миграция `packages/core/prisma/migrations/20260718061612_room_lifecycle/migration.sql` заморожена.** Любое изменение — только новой миграцией. То же для миграций identity-среза после слияния: `20260722151900_identity_seam` и `20260722153952_room_organizer_fk` — **заморожены с 2026-07-22**. То же для миграции lifecycle-emit среза: `20260722180147_realtime_log_event` — **заморожена с 2026-07-22**.
- **Конвенция порядка блокировок (из финального ревью lifecycle-эмита):** advisory lock комнаты — всегда leaf-most; транзакция, захватившая его, не должна после этого писать в `room."Room"` (сейчас порядок везде безопасен: `transition` берёт row-lock до advisory lock, `commitCoreEvent` не трогает Room). Будущие пути эмита обязаны его сохранять.
- **Prisma 7.8 adapter-pg ловушка:** `$queryRaw` не десериализует `void`-возвращающие выражения (`pg_advisory_xact_lock`) — использовать `$executeRaw`. Учитывать при написании будущих планов.
- **Инвариант «change both or neither»:** предикат `kind = 'REGISTERED' AND deletedAt IS NULL` живёт в двух местах — частичный индекс `"Identity_registered_email_key"` (миграция identity_seam) и guarded INSERT в `RoomService.create`. Менять только вместе (design §7).
- **Хост-порт 5432 занят чужим контейнером `lt-pg`** (не проектным, не трогать). Authoring-контейнер миграций (`mm-migrate`, эфемерный) публиковать на свободный порт (в срезе identity использовались 55432/55433) и подставлять его в `DATABASE_URL`.
- **`prisma migrate dev` не всегда регенерирует клиент; явный `pnpm exec prisma generate` требует DATABASE_URL** и cwd = корень репозитория (обнаружение `prisma.config.ts`).
- **`packages/core/src/testing/postgres.testcontainer.ts` — переиспользуемый паттерн ядра.** Все будущие DB-тесты пойдут через него, поэтому его острые углы наследуются: он мутирует глобальный `process.env.DATABASE_URL` и не восстанавливает его (безопасно только при `maxWorkers: 1`), и требует cwd = корень репозитория для обнаружения `prisma.config.ts`.
- **Прогон интеграционной ланы поднимает контейнеры Postgres** (по одному на describe с `startTestDb`; ~8 с локально на файл, дольше на холодном CI-раннере). Docker Desktop должен быть запущен.

## Отложенные follow-up (не гейтят; полный список с обоснованиями — в леджере)

Самое ценное из накопленного:

- **`updateManyAndReturn` доступен на закреплённой Prisma 7.8.0** — схлопнет 3 запроса в 2 в обеих мутациях `RoomService` (transition/softDelete) и попутно уберёт дублирование хвоста `if (count===0) throw` + re-read. Проверено ревьюером, не гипотеза. **Осторожно:** после среза lifecycle-эмита `transition` — транзакция с побочным эмитом; применение updateManyAndReturn не должно разорвать атомарность «UPDATE + лог».
- **Нет гейта на дрейф миграций.** `prisma migrate diff --from-migrations` здесь непригоден: Prisma 7.8 требует `datasource.shadowDatabaseUrl` в `prisma.config.ts`, которого нет. Стоит завести настоящий гейт, пока миграций мало.
- **Общая рекурсивная `jsonValueSchema`** для payload в `log-event`/`projected-event` — `z.record(z.string(), z.unknown())` не принуждает структурно REQ-CTR-002.
- Косметика: breadcrumb в `schema.prisma` о существовании рукописного CHECK; ассерт ортогональности soft-delete добавлен только для ветки CANCELLED (из трёх удаляемых статусов).

## Осталось недоделанным

- **14 коммитов не запушены** (identity-срез + дизайн/план lifecycle-эмита + lifecycle-emit срез 4 коммита + merge + handoff-обновления). Публикация — решение владельца. CI видел только фазу 0; коммиты identity-среза и новее CI ещё не видел.
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.
- **Живой boot артефакта** прогнан на закрытии lifecycle-emit среза (`docker compose up --build` → все 4 миграции применены на свежей БД → `/health/ready` 200).

## Session 2026-07-22 (ночь, исполнение lifecycle-эмита)

### Что сделано

- Исполнен план `2026-07-22-realtime-log-lifecycle-emit-implementation-plan.md` через subagent-driven-development: 4/4 задачи, каждая с ревью (spec + quality), финальное whole-branch ревью — **ready to merge, без Critical/Important**. Слито в `main` (--no-ff), ветка удалена, merged-дерево байт-в-байт совпало с ревьюенным HEAD.
- Event Log построен с нуля: таблица `realtime."LogEvent"` + enum `EventVisibility` (миграция `20260722180147_realtime_log_event`, теперь заморожена), `EventLogService.commitCoreEvent` (zod-валидация до advisory-lock; `pg_advisory_xact_lock` на комнату; seq атомарно одним INSERT…SELECT), `RoomService.transition` в `prisma.$transaction` с эмитом `room.completed`/`room.cancelled` (fail-closed, REQ-DEV-008).
- Гейты на merge-HEAD: int 33/33, unit 220/220, lint/typecheck/build, boundary-check 0, guardrails, boot с 4 миграциями — всё зелёное.
- Два отклонения от вербатим-кода плана (оба — баги плана, подтверждены ревьюерами): PK-ассерт `toBe('PRIMARY KEY ("roomId", seq)')` (Postgres не квотит `seq`); `$executeRaw` вместо `$queryRaw` для advisory-lock (void-десериализация).
- Минорные находки (4) триажированы финальным ревьюером как follow-up; единственная новая — недокументированная конвенция порядка блокировок (внесена выше в ограничения и в точки входа следующего среза).

### Коммиты этой сессии

- `b5dee43` feat(core): realtime.LogEvent table + EventVisibility enum migration (REQ-RT-001)
- `ab20211` feat(core): EventLogService.commitCoreEvent primitive + RealtimeModule (REQ-RT-001, REQ-RT-007)
- `bcce15a` feat(core): emit room.completed/room.cancelled to log in transition transaction (REQ-RT-010, REQ-DEV-008)
- `b2cacb7` feat(core): export and register RealtimeModule in server (REQ-RT-010)
- merge `--no-ff` phase-1-lifecycle-log-emit → main

### Локальное состояние (не в git)

- Docker Desktop запущен; `lt-pg` на 5432 нетронут; authoring/compose-контейнеры убраны (`mm-migrate` удалён, compose — `down -v`).
- `.superpowers/sdd/` — леджер (`progress.md`) с полной историей среза, брифы/отчёты в `lifecycle-emit/`, review-пакеты в `review-*.diff`.

### Осталось недоделанным

- Пуш 14 коммитов — решение владельца.
- Следующий срез: appSettings write path (REQ-RT-004) — см. «Следующее действие».

## Session 2026-07-22 (вечер, brainstorm → plan)

### Что сделано

- Выбран срез фазы 1 из двух кандидатов HANDOFF'а: **lifecycle-эмит в лог (REQ-RT-010)** (альтернатива — appSettings write path, остаётся следующим).
- Пройден полный цикл superpowers:brainstorming → дизайн → superpowers:writing-plans. Дизайн одобрен владельцем по секциям, план написан с self-review; оба закоммичены.
- **Два решения владельца на brainstorm** (зафиксированы в дизайне §0):
  1. Эмит `room.activated` — НЕ в этом срезе: его payload = пин `(appId, manifestVersion)` (REQ-RT-004), которому неоткуда взяться до appSettings write path. Срез эмитит только `room.completed`/`room.cancelled`; REQ-RT-010 закрывается полностью после обоих срезов. Отклонённые варианты: переупорядочить срезы, ослабить контракт (пин опциональным).
  2. Таблица лога — в модуле/схеме `realtime` (домен Realtime по ADR-003), не отдельный `event-log` (шестой core-домен) и не схема `core` (упоминание в §5 пакета уже опровергнуто практикой identity-среза).
- Ключевая находка контекста: таблицы лога в БД нет — срез строит Event Log с нуля (миграция + append-примитив + seq); SDK-словарь `CORE_EVENTS` и порядок шагов commit (SDK-дизайн §7) уже существуют и переиспользуются без изменений.
- Решение об исполнении: **subagent-driven-development в новой сессии** (как identity-срез).

### Коммиты этой сессии

- `9fa78d7` docs(design): lifecycle log emit slice design (REQ-RT-010, REQ-RT-001, REQ-RT-007, REQ-DEV-008)
- `893629c` docs(plan): lifecycle log emit implementation plan (REQ-RT-010, REQ-RT-001, REQ-RT-007, REQ-DEV-008)

### Локальное состояние (не в git)

- Docker Desktop запущен. Хост-порт 5432 занят чужим контейнером `lt-pg` — не трогать. Authoring-контейнеров `mm-migrate` сейчас нет (план создаст свой на 55432 в Task 1).
- `.superpowers/sdd/` — леджер (`progress.md`), брифы/отчёты прошлых срезов. Не отслеживается git; `git clean -fdx` уничтожит.
- Внешние системы: side-effects нет — пуш не выполнялся, тестовые прогоны в этой сессии не запускались (только чтение кода/доков).

### Осталось недоделанным

- Исполнение плана lifecycle-эмита — целиком впереди (4 задачи, новая сессия, subagent-driven).
- Пуш 12 коммитов — решение владельца.
