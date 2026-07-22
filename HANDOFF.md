# HANDOFF

**Date:** 2026-07-22
**Branch:** `main` (рабочее дерево чистое; **2 коммита впереди `origin/main`, не запушено** — дизайн и план identity-среза) — последний коммит `48ce558` docs(plan): identity minimal seam implementation plan (2026-07-22).

**Состояние фазы 1.** SDK contract core, сервис регистрации манифеста и **Room lifecycle** — завершены и слиты в `main` (опубликовано на origin 2026-07-22). Следующий срез — **Identity minimal seam** (REQ-ID-005 + REQ-ID-001): brainstorm → design → plan пройдены и одобрены владельцем, **исполнение не начиналось**. Этап продукта — MVP. Метод — AIDD / Specification-Driven.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. **`.superpowers/sdd/progress.md` — леджер исполнения планов** (SDK + app-registry + Room lifecycle). Читать после CLAUDE.md. Задачи COMPLETE — сделаны, не пере-диспатчить. Леджера нет в git (`.superpowers/` игнорируется) — он существует только на этой машине.
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `docs/sessions/2026-07-22-identity-minimal-seam-design.md` — **одобренный дизайн текущего среза**; §6 — список сознательно НЕ построенных швов (нельзя молча начать строить).
6. `docs/sessions/2026-07-22-identity-minimal-seam-implementation-plan.md` — **план к исполнению** (4 задачи, TDD, self-review пройден).
7. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.

Исполненные планы (`2026-07-16-sdk-contract-core`, `2026-07-18-app-registry-registration`, `2026-07-18-room-lifecycle`, их дизайн-доки) читать только при разборе истории — их работа в коммитах.

## Два гейта над фазами

1. **Юрист** — до первого события с посторонними или призами. Список вопросов готов (`docs/legal/questions-for-lawyer.md`). Блокирует старт работы с реальными PII, не блокирует реализацию.
2. **Первое живое событие** — до тяжёлых вложений в фазу 3 (rewards/лотерея).

## Следующее действие

**Исполнить `docs/sessions/2026-07-22-identity-minimal-seam-implementation-plan.md` через `superpowers:subagent-driven-development`** (решение владельца 2026-07-22: subagent-driven, в новой сессии). Свежий субагент на задачу, двухстадийное ревью между задачами — как на Room lifecycle. 4 задачи: SDK-словарь (kind/role) → Identity-модель + частичный индекс → FK + починка room-тестов → guarded INSERT.

После identity-среза — выбор владельца из оставшихся продолжений: **appSettings write path** (REQ-RT-004) или **lifecycle-эмит в лог** (REQ-RT-010).

**Forward-обязательство** (не забыть при первом же выходе наружу): первый потребитель, отдающий `ContractError`/доменную ошибку по HTTP/Socket.io, обязан идти через типизированный код без стектрейса, не `err.message` (REQ-SEC-006). Room-ошибки (`ROOM_TRANSITION_INVALID`, `ROOM_CONFLICT`) и готовящийся `ROOM_ORGANIZER_NOT_REGISTERED` сейчас core-внутренние и границу не пересекают.

## Долгоживущие ограничения, введённые срезами

- **Миграция `packages/core/prisma/migrations/20260718061612_room_lifecycle/migration.sql` заморожена.** Любое изменение — только новой миграцией. То же правило для миграций identity-среза после их слияния.
- **`packages/core/src/testing/postgres.testcontainer.ts` — переиспользуемый паттерн ядра.** Все будущие DB-тесты пойдут через него, поэтому его острые углы наследуются: он мутирует глобальный `process.env.DATABASE_URL` и не восстанавливает его (безопасно только при `maxWorkers: 1`), и требует cwd = корень репозитория для обнаружения `prisma.config.ts`.
- **Прогон интеграционной ланы поднимает контейнеры Postgres** (по одному на describe с `startTestDb`; ~8 с локально на файл, дольше на холодном CI-раннере). Docker Desktop должен быть запущен.

## Отложенные follow-up (не гейтят; полный список с обоснованиями — в леджере)

Самое ценное из накопленного:

- **`updateManyAndReturn` доступен на закреплённой Prisma 7.8.0** — схлопнет 3 запроса в 2 в обеих мутациях `RoomService` (transition/softDelete) и попутно уберёт дублирование хвоста `if (count===0) throw` + re-read. Проверено ревьюером, не гипотеза.
- **Нет гейта на дрейф миграций.** `prisma migrate diff --from-migrations` здесь непригоден: Prisma 7.8 требует `datasource.shadowDatabaseUrl` в `prisma.config.ts`, которого нет. Стоит завести настоящий гейт, пока миграций мало.
- **Общая рекурсивная `jsonValueSchema`** для payload в `log-event`/`projected-event` — `z.record(z.string(), z.unknown())` не принуждает структурно REQ-CTR-002.
- Косметика: breadcrumb в `schema.prisma` о существовании рукописного CHECK; ассерт ортогональности soft-delete добавлен только для ветки CANCELLED (из трёх удаляемых статусов).

## Осталось недоделанным

- **2 коммита (дизайн + план identity-среза) не запушены.** Публикация — решение владельца. Предыдущие 15 коммитов запушены 2026-07-22; CI-лана интеграционных тестов **проверена в CI** — первый прогон на `ubuntu-latest` зелёный целиком (все 13 шагов, включая `test:int` с Testcontainers). Больше не «непроверено в CI».
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.
- **Живой boot артефакта** прогонялся на закрытии фазы 0 (`docker compose up --build` → `/health/ready` зелёный). В фазе 1 не трогался.

## Session 2026-07-22

### Что сделано

- Запушено 15 коммитов на `origin/main` (`4dea9cf..a06028a`) — работа фазы 1 опубликована. Первый реальный CI-прогон интеграционной ланы на GitHub-раннере: **зелёный** (run 29926892739, все шаги включая `pnpm run test:int`; образ postgres:17 и Ryuk на `ubuntu-latest` работают).
- Исправлено внутреннее противоречие дизайн-дока Rooms: §4 шаг 3 предписывал хардкод `status <> 'ACTIVE'` против §3 «таблица — единственный источник истины». Документ приведён к §3 (код уже следовал ему). Коммит `a06028a`.
- Пройден полный цикл brainstorm → design → plan среза **Identity minimal seam** по процессу CLAUDE.md + superpowers: дизайн одобрен владельцем по секциям, план написан с self-review. Коммиты `fdb1447` (дизайн), `48ce558` (план).

### Коммиты этой сессии

- `a06028a` docs(design): align Rooms §4 with §3 — soft-delete guard derives from DELETABLE_STATUSES
- `fdb1447` docs(design): identity minimal seam — REQ-ID-005 guarded INSERT + REQ-ID-001 schema
- `48ce558` docs(plan): identity minimal seam implementation plan (REQ-ID-005, REQ-ID-001, phase 1)

### Решения владельца этой сессии (rationale — чтобы не переоткрывать)

- **Следующий срез — Identity + Membership, а не appSettings или lifecycle-эмит.** Rationale: снимает заглушку `organizerId`, фундамент для остальных срезов.
- **Скоуп — минимальный шов.** Без membership-таблицы, токенов, OAuth, гостевого входа — им неоткуда писаться до потоков входа. Швы зафиксированы в §6 дизайн-дока.
- **Принуждение REQ-ID-005 — guarded INSERT (подход A), не триггер БД.** TOCTOU невозможен структурно: в ф.1 kind иммутабелен (амендмент v1.3), позже флип только GUEST→REGISTERED. Триггер — задел по фильтру амендмента (актора «писатель мимо сервиса» на этапе нет), добавляется аддитивной миграцией.
- **Запушить накопленное немедленно** — снял многонедельный push-deferred окончательно; CI-лана подтверждена.
- **Исполнение плана — subagent-driven, в новой сессии** (не в этой).

### Локальное состояние (не в git)

- Docker Desktop запущен — нужен для интеграционной ланы и для authoring-контейнера миграций (`mm-migrate`, эфемерный; после сессии не остался).
- `.superpowers/sdd/` — леджер, брифы и отчёты субагентов. Не отслеживается git; `git clean -fdx` уничтожит.
- Внешние системы: единственный side-effect — пуш на `origin/main` (санкционирован владельцем). Тесты били только по одноразовым контейнерам.
