# HANDOFF

**Date:** 2026-07-22
**Branch:** `main` (рабочее дерево чистое; **9 коммитов впереди `origin/main`, не запушено** — дизайн/план identity-среза + сам срез + merge) — последний коммит `75b97b7` Merge branch 'phase-1-identity-seam' (2026-07-22).

**Состояние фазы 1.** SDK contract core, сервис регистрации манифеста, Room lifecycle и **Identity minimal seam** (REQ-ID-001 + REQ-ID-005) — завершены и слиты в `main`. Identity-срез исполнен 2026-07-22 через subagent-driven-development: 4 задачи, все ревью чистые, финальное whole-branch ревью — ready to merge. Этап продукта — MVP. Метод — AIDD / Specification-Driven.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. **`.superpowers/sdd/progress.md` — леджер исполнения планов** (SDK + app-registry + Room lifecycle). Читать после CLAUDE.md. Задачи COMPLETE — сделаны, не пере-диспатчить. Леджера нет в git (`.superpowers/` игнорируется) — он существует только на этой машине.
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `docs/sessions/2026-07-22-identity-minimal-seam-design.md` — дизайн исполненного identity-среза; §6 — список сознательно НЕ построенных швов (нельзя молча начать строить). Актуально и после среза: швы остаются непостроенными.
6. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы (`2026-07-16-sdk-contract-core`, `2026-07-18-app-registry-registration`, `2026-07-18-room-lifecycle`, `2026-07-22-identity-minimal-seam`, их дизайн-доки) читать только при разборе истории — их работа в коммитах.

## Два гейта над фазами

1. **Юрист** — до первого события с посторонними или призами. Список вопросов готов (`docs/legal/questions-for-lawyer.md`). Блокирует старт работы с реальными PII, не блокирует реализацию.
2. **Первое живое событие** — до тяжёлых вложений в фазу 3 (rewards/лотерея).

## Следующее действие

**Выбор владельца из оставшихся продолжений фазы 1: appSettings write path (REQ-RT-004) или lifecycle-эмит в лог (REQ-RT-010).** Identity-срез закрыт; оба кандидата разблокированы. Выбранный срез идёт полным циклом CLAUDE.md + superpowers: brainstorm → design → plan → subagent-driven-development.

Со среза identity есть пакет follow-up для **первого реального identity-пишущего потока** (guest-join / OAuth), подобрать его планом явно:
- presence-тест индекса: ассертить `UNIQUE` и колонку в indexdef (сейчас ловят только поведенческие тесты);
- кросс-kind кейс индекса: GUEST с email живого REGISTERED — разрешён;
- malformed non-UUID `organizerId` → сейчас сырой Postgres uuid-syntax error; маппинг в типизированную ошибку — на boundary-слое первого транспорта (REQ-SEC-006);
- косметика: `harness.int-spec.ts` сидит identity без email; устаревший комментарий в `jest.integration.config.js` («per file» → «per describe»).

**Forward-обязательство** (не забыть при первом же выходе наружу): первый потребитель, отдающий `ContractError`/доменную ошибку по HTTP/Socket.io, обязан идти через типизированный код без стектрейса, не `err.message` (REQ-SEC-006). Room-ошибки (`ROOM_TRANSITION_INVALID`, `ROOM_CONFLICT`, `ROOM_ORGANIZER_NOT_REGISTERED`) сейчас core-внутренние и границу не пересекают.

## Долгоживущие ограничения, введённые срезами

- **Миграция `packages/core/prisma/migrations/20260718061612_room_lifecycle/migration.sql` заморожена.** Любое изменение — только новой миграцией. То же для миграций identity-среза после слияния: `20260722151900_identity_seam` и `20260722153952_room_organizer_fk` — **заморожены с 2026-07-22**.
- **Инвариант «change both or neither»:** предикат `kind = 'REGISTERED' AND deletedAt IS NULL` живёт в двух местах — частичный индекс `"Identity_registered_email_key"` (миграция identity_seam) и guarded INSERT в `RoomService.create`. Менять только вместе (design §7).
- **Хост-порт 5432 занят чужим контейнером `lt-pg`** (не проектным, не трогать). Authoring-контейнер миграций (`mm-migrate`, эфемерный) публиковать на свободный порт (в срезе identity использовались 55432/55433) и подставлять его в `DATABASE_URL`.
- **`prisma migrate dev` не всегда регенерирует клиент; явный `pnpm exec prisma generate` требует DATABASE_URL** и cwd = корень репозитория (обнаружение `prisma.config.ts`).
- **`packages/core/src/testing/postgres.testcontainer.ts` — переиспользуемый паттерн ядра.** Все будущие DB-тесты пойдут через него, поэтому его острые углы наследуются: он мутирует глобальный `process.env.DATABASE_URL` и не восстанавливает его (безопасно только при `maxWorkers: 1`), и требует cwd = корень репозитория для обнаружения `prisma.config.ts`.
- **Прогон интеграционной ланы поднимает контейнеры Postgres** (по одному на describe с `startTestDb`; ~8 с локально на файл, дольше на холодном CI-раннере). Docker Desktop должен быть запущен.

## Отложенные follow-up (не гейтят; полный список с обоснованиями — в леджере)

Самое ценное из накопленного:

- **`updateManyAndReturn` доступен на закреплённой Prisma 7.8.0** — схлопнет 3 запроса в 2 в обеих мутациях `RoomService` (transition/softDelete) и попутно уберёт дублирование хвоста `if (count===0) throw` + re-read. Проверено ревьюером, не гипотеза.
- **Нет гейта на дрейф миграций.** `prisma migrate diff --from-migrations` здесь непригоден: Prisma 7.8 требует `datasource.shadowDatabaseUrl` в `prisma.config.ts`, которого нет. Стоит завести настоящий гейт, пока миграций мало.
- **Общая рекурсивная `jsonValueSchema`** для payload в `log-event`/`projected-event` — `z.record(z.string(), z.unknown())` не принуждает структурно REQ-CTR-002.
- Косметика: breadcrumb в `schema.prisma` о существовании рукописного CHECK; ассерт ортогональности soft-delete добавлен только для ветки CANCELLED (из трёх удаляемых статусов).

## Осталось недоделанным

- **9 коммитов не запушены** (3 docs + 5 среза + merge). Публикация — решение владельца. CI-лана интеграционных тестов проверена в CI (первый прогон зелёный), но новые коммиты identity-среза CI ещё не видел.
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.
- **Живой boot артефакта** прогонялся на закрытии фазы 0 (`docker compose up --build` → `/health/ready` зелёный). В фазе 1 не трогался.

## Session 2026-07-22

### Что сделано

- Исполнен план **Identity minimal seam** (`docs/sessions/2026-07-22-identity-minimal-seam-implementation-plan.md`) через `superpowers:subagent-driven-development`, решение владельца от прошлой сессии. 4 задачи, свежий субагент на задачу, task-ревью после каждой — все чистые с первого прохода; финальное whole-branch ревью (fable) — **ready to merge** с одним fix-before-merge (опечатка в комментарии фикстуры, исправлена `c79c242`).
- Слито в `main` `--no-ff` (`75b97b7`), все гейты перепроверены на слитом результате: boundary-check 0/170, guardrails живы, SDK 162/162, core typecheck + unit 55/55 + lint + int 21/21. Ветка `phase-1-identity-seam` удалена.
- Что построено: SDK-словарь `identityKindSchema`/`memberRoleSchema` (без потребителей, по дизайну); схема БД `identity` + модель `Identity` + рукописный частичный уникальный индекс `Identity_registered_email_key` (REQ-DEV-006); декларативный FK `Room_organizerId_fkey` (Restrict) + `seedIdentity`; атомарный guarded INSERT в `RoomService.create` с коллапсированной ошибкой `ROOM_ORGANIZER_NOT_REGISTERED` (REQ-ID-005).
- Единственное отклонение от плана: Task 3 задел `packages/core/src/testing/harness.int-spec.ts` вне списка файлов брифа — вынужденно (смоук-тест создавал комнату с голым UUID, FK его сломал), минимально и в паттерне; ревьюер подтвердил по дифу.

### Коммиты этой сессии

- `508e958` feat(sdk): identityKind + memberRole contract vocabulary (REQ-ID-001, REQ-ID-011)
- `a74f057` feat(core): Identity model + partial unique index migration (REQ-ID-001, REQ-DEV-006)
- `3595d54` feat(core): FK room.organizerId to identity.id + test seeding (REQ-ID-005)
- `8086a54` feat(core): enforce REGISTERED organizer via atomic guarded INSERT (REQ-ID-005)
- `c79c242` fix(sdk): correct fixture comment typo (REQ-ID-001)
- `75b97b7` Merge branch 'phase-1-identity-seam' — Identity minimal seam slice (REQ-ID-001, REQ-ID-005)

### Локальное состояние (не в git)

- Docker Desktop запущен. Хост-порт 5432 занят чужим контейнером `lt-pg` — не трогать; authoring-контейнеры `mm-migrate` сессии остановлены/удалены.
- `.superpowers/sdd/` — леджер (`progress.md`), брифы/отчёты среза в `identity/`, диф-пакеты ревью. Не отслеживается git; `git clean -fdx` уничтожит.
- Внешние системы: side-effects нет — пуш не выполнялся, тесты били только по одноразовым контейнерам.
