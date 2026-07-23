# HANDOFF

**Date:** 2026-07-23
**Branch:** `main` (рабочее дерево чистое, синхронизирован с `origin/main`) — последний коммит `eaada54` Merge pull request #1 (appSettings write path, 2026-07-23).

**Состояние фазы 1.** SDK contract core, сервис регистрации манифеста, Room lifecycle, Identity minimal seam (REQ-ID-001 + REQ-ID-005), Lifecycle-эмит в лог (REQ-RT-010 2/3) и **appSettings write path (REQ-RT-004, REQ-CORE-007, REQ-RT-010→3/3)** — завершены и слиты в `main`. Срез appSettings исполнен через subagent-driven-development: 5/5 задач, все ревью чистые, финальное whole-branch ревью — ready to merge; слит PR #1 (merge-коммит `eaada54`, дерево байт-в-байт == ревьюенному HEAD). **Следующий срез не выбран** — решение владельца (кандидаты и навешанные follow-up — ниже). Этап продукта — MVP. Метод — AIDD / Specification-Driven.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. **`.superpowers/sdd/progress.md` — леджер исполнения планов** (все шесть срезов). Читать после CLAUDE.md. Задачи COMPLETE — сделаны, не пере-диспатчить. Леджера нет в git (`.superpowers/` игнорируется) — он существует только на этой машине; `git clean -fdx` уничтожит.
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `docs/sessions/2026-07-23-appsettings-write-path-design.md` — образец свежего дизайна среза (§0 — решения владельца, §5 — post-lock re-read, §9 — швы).
6. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы (sdk-contract-core, app-registry, room-lifecycle, identity-minimal-seam, realtime-log-lifecycle-emit, appsettings-write-path, их дизайн-доки) читать только при разборе истории — их работа в коммитах.

## Следующее действие

**Выбор следующего среза — решение владельца.** Навешанные на будущие срезы follow-up пакеты (подбирать планами явно):

**Для следующего среза, трогающего configure/app-registry** (из финального ревью appSettings, ~15 строк суммарно):
- guard в `configure` на `settings === undefined || settings === null` → `AppSettingsInvalidError` (сейчас: permissive-схема + null даёт сырую P2011 от CHECK, а re-configure с `undefined` молча оставляет stale settings под новым пином; гейт активации ловит до эмита, но отказ нетипизирован);
- `ValidateFunction` импортировать из `ajv/dist/2020`, а не из `ajv` (type-only косметика);
- race-тест configure-vs-activate со второй версией манифеста (quiz@2) — сейчас обе стороны гонки пинят quiz@1, и ассерт «пин == строке» проходит тривиально;
- при появлении транспорта: зафиксировать в контрактных доках допущение «settings — не-null JSON value».

**Для первого реального identity-пишущего потока** (guest-join / OAuth), со среза identity:
- presence-тест индекса: ассертить `UNIQUE` и колонку в indexdef (сейчас ловят только поведенческие тесты);
- кросс-kind кейс индекса: GUEST с email живого REGISTERED — разрешён;
- malformed non-UUID `organizerId` → сейчас сырой Postgres uuid-syntax error; маппинг в типизированную ошибку — на boundary-слое первого транспорта (REQ-SEC-006);
- косметика: `harness.int-spec.ts` сидит identity без email; устаревший комментарий в `jest.integration.config.js` («per file» → «per describe»).

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

- **Выбор следующего среза** — решение владельца (кандидаты и follow-up пакеты — в «Следующее действие»).
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.

## Session 2026-07-23 (исполнение среза appSettings write path, subagent-driven)

### Что сделано

- Исполнен план `docs/sessions/2026-07-23-appsettings-write-path-implementation-plan.md` через superpowers:subagent-driven-development: 5 задач, свежий implementer + task-ревьюер на задачу (модели: haiku для транскрипционных, sonnet для интеграционных, opus для concurrency-задачи, fable для финального ревью).
- **Все ревью чистые** (spec ✅ + quality approved по каждой задаче); финальное whole-branch ревью (fable) — ready to merge, без Critical/Important. Кросс-задачные инварианты проверены: post-lock re-read держит пин события == замороженной строке; advisory lock leaf-most, `configure` цикла блокировок не создаёт; CHECK недостижим из сервисного пути; отказы активации — throw в транзакции с полным откатом.
- **Первый PR репозитория:** ветка `phase-1-appsettings-write-path` запушена (решение владельца, опция 2 finishing-скилла), PR #1 создан и **смёржен владельцем на GitHub** (merge-коммит, не squash). Локальный main синхронизирован fast-forward; feature-ветки (local + remote) удалены. В PR вошли и 3 ранее незапушенных docs-коммита — `origin/main` теперь полностью догнан, **непушенных коммитов не осталось**.
- Отклонения исполнителей (оба проверены ревьюерами): 6-й call-site трёхаргументного конструктора найден в `realtime/event-log.int-spec.ts` (план знал про 5 в room-спеке); форма `test:int -- -t` заменена на рабочую без `--`.
- Полные гейты + живой boot (Task 5): lint/typecheck/unit (sdk 162, core 62, server 3)/int 49/49/boundary-check 0 viol (196 модулей)/guardrails 3/3/build — зелёные; compose boot с 5 миграциями, `/health/ready` 200, стек снесён `down -v`, `lt-pg` нетронут.

### Коммиты этой сессии

- `3ab4dd1` feat(core): room app config columns + triple CHECK migration (REQ-RT-004)
- `4fe39b4` feat(core): AppRegistryService.validateSettings with ajv cache (REQ-CORE-007)
- `e23b63e` feat(core): RoomService.configure write path (REQ-RT-004)
- `b89dfcc` feat(core): activation freeze + room.activated emit (REQ-RT-004, REQ-RT-010, REQ-CORE-007, REQ-DEV-008)
- `eaada54` Merge pull request #1 (GitHub, владелец)

### Локальное состояние (не в git)

- Docker Desktop запущен; `lt-pg` на 5432 нетронут; проектных контейнеров нет (compose снесён, `mm-migrate` удалён).
- `.superpowers/sdd/` — леджер (`progress.md`) с полной историей шести срезов + briefs/reports/diff-пакеты в `appsettings-write-path/`. Не отслеживается git; `git clean -fdx` уничтожит.
- Внешние системы: push ветки + PR #1 на GitHub (смёржен) — единственные side-effects; прод-тестов не было, тесты только против Testcontainers и локального compose.

### Осталось недоделанным

- Выбор следующего среза — решение владельца (см. «Следующее действие»).
- Follow-up пакеты appSettings/identity/event-commit — подобрать соответствующими планами.
- Юрист — гейт 1 открыт, действие вне агента.
