# HANDOFF

**Date:** 2026-07-18
**Branch:** `phase-1-room-lifecycle` (2 коммита впереди `origin/main`, **не запушена**; создана от `main`) — последний коммит `50f7fe7` docs(plan): room lifecycle implementation plan. `main` синхронизирован с `origin/main`.

**Состояние фазы 1.** SDK contract core И сервис регистрации манифеста — **ЗАВЕРШЕНЫ И СЛИТЫ в `main`** (SDK 9/9, app-registry 2/2, финальные ревью чистые, 6/6 гейтов зелёные). Первый настоящий core-side потребитель контракта — `registerManifest` + `assertContractRangeSatisfied` + boot-time immutable реестр (`buildAppRegistry`, `AppRegistryModule` с пустым швом `APP_MANIFESTS=[]` под фазу 2). **Текущая работа:** владелец выбрал **Rooms** как следующий кусок ядра; в этой сессии выполнены brainstorm → design → implementation plan для ПЕРВОГО среза арки Rooms (**Room lifecycle**). Кода ещё нет — только дизайн-док и план, оба закоммичены на ветке. Этап продукта — MVP. Метод — AIDD / Specification-Driven.

## Как войти в контекст за одно чтение

1. `CLAUDE.md` — рамка проекта и интеграция с superpowers (правило «решено vs открыто»).
2. **`.superpowers/sdd/progress.md` — леджер исполнения прошлых планов** (SDK + app-registry). Читать после CLAUDE.md. Задачи COMPLETE — сделаны, не пере-диспатчить. Леджера нет в git (`.superpowers/` игнорируется).
3. `docs/spec/normative-package-v1.2.md` — источник истины: 11 ADR, ~90 требований, §5 фазовый план.
4. `docs/spec/amendment-v1.3-phase-remapping.md` — **утверждённая пере-разметка фаз**; меняет объём фазы 1. Читать вместе с пакетом.
5. `docs/sessions/2026-07-16-sdk-contract-core-design.md` — дизайн ядра SDK-контракта; §7 «точки принуждения» — Rooms фундамент для точек #3–#5.
6. `docs/sessions/2026-07-16-sdk-contract-core-implementation-plan.md` — исполненный план SDK.
7. `docs/sessions/2026-07-18-app-registry-registration-design.md` + `...-implementation-plan.md` — дизайн и исполненный план сервиса регистрации (точка #1 §7).
8. `docs/roadmap.md` — траектория прототип→MVP→платформа→BaaS.
9. **`docs/sessions/2026-07-18-room-lifecycle-design.md` — ОДОБРЕННЫЙ дизайн текущего среза** (Room lifecycle). Читать перед планом.
10. **`docs/sessions/2026-07-18-room-lifecycle-implementation-plan.md` — ГОТОВЫЙ план реализации** (7 задач, TDD). Вход для исполнения.

## Два гейта над фазами

1. **Юрист** — до первого события с посторонними или призами. Список вопросов готов (`docs/legal/questions-for-lawyer.md`). Блокирует старт работы с реальными PII, не блокирует реализацию.
2. **Первое живое событие** — до тяжёлых вложений в фазу 3 (rewards/лотерея).

## Следующее действие

**Исполнить план Room lifecycle** — `docs/sessions/2026-07-18-room-lifecycle-implementation-plan.md`.

- **Способ (решение владельца):** subagent-driven — `superpowers:subagent-driven-development`, свежий субагент на задачу + двухстадийное ревью между задачами. Начинать с **Task 1** (чистая машина состояний, TDD, без БД).
- **Ветка:** уже на месте — `phase-1-room-lifecycle` (дизайн `2aa6844` + план `50f7fe7`). Работать на ней.
- **Предпосылка:** для Task 3–5 нужен запущенный **Docker** (Testcontainers поднимает эфемерный Postgres). Тесты бьют только по одноразовому контейнеру — не по проду (глобальное правило тестирования соблюдено конструктивно).
- **Объём среза (согласован):** минимальный Room = `{id, organizerId, status, deletedAt, createdAt, updatedAt}` + машина состояний REQ-RT-005 + soft-delete. Headline-требование — **REQ-RT-005**. Осознанно НЕ строится (швы словами, не кодом): lifecycle-эмит в лог (REQ-RT-010), appSettings/пин/заморозка (REQ-RT-004), organizer=REGISTERED+FK (REQ-ID-005), авторизация переходов, HTTP-поверхность, код комнаты/политики (REQ-ID-013/002), запечатывание лога (REQ-RT-016). Полный список швов — §10 дизайн-дока.
- **Ключевые решения дизайна** (чтобы не переоткрывать): чистый state-machine модуль + тонкий RoomService; переходы — **атомарный условный UPDATE** (`WHERE status=:from`), не read-then-write; две core-внутренние ошибки `ROOM_TRANSITION_INVALID` / `ROOM_CONFLICT` (не в SDK); тесты — Testcontainers.

**Forward-обязательство** (из плана app-registry, актуально для будущих планов event-commit/Rooms-HTTP): первый потребитель, отдающий `ContractError`/доменную ошибку наружу по HTTP/Socket.io, обязан идти через типизированный код без стектрейса, не `err.message` (REQ-SEC-006).

## Отложенные follow-up (не гейтят; полный список в леджере, раздел FOLLOW-UPS FILED)

- **Первый по приоритету:** общая рекурсивная `jsonValueSchema` для payload в `log-event`/`projected-event` — `z.record(z.string(), z.unknown())` не принуждает структурно REQ-CTR-002. Небольшая дизайн-задача; не требует Rooms.
- **Core-side:** сигнатура `composeEventType(namespace)` держится дисциплиной вызывающих; первый core-side вызывающий (сборщик проекции/коммит-пайплайн) — в более позднем плане. Долговечный фикс — брендированный `AppId` (z.brand).
- **Дешёвое харденинг-опционально:** фикстуры union/record-refine для стража; `it.each` над терминальными переходами; `!Array.isArray` в `asRecord`. Копеечное.

## Осталось недоделанным (шире плана)

- **Ветка `phase-1-room-lifecycle` не запушена** — 2 коммита (дизайн+план) только локально. Публикация — решение владельца.
- **Room lifecycle не реализован** — есть дизайн и план, кода нет. Исполнение — следующая сессия (см. «Следующее действие»).
- **Вопросы юристу не заданы** — гейт 1 открыт, действие вне агента.
- **Живой boot артефакта** прогонялся на закрытии фазы 0 (`docker compose up --build` → `/health/ready` зелёный). В фазе 1 не трогался.

## Session 2026-07-18 — Rooms lifecycle design+plan

### Что сделано
- Владелец выбрал **Rooms** как следующий кусок ядра фазы 1 (из трёх опций прошлого HANDOFF).
- Проведён brainstorm (`superpowers:brainstorming`): срез сужен до **Room lifecycle** (владелец отклонил вариант «Rooms+Identity+Membership» и «Identity-first» в пользу чистого минимального Room). Решено отложить appSettings/пин/заморозку (минимальный Room). Внутренняя структура — Подход 1 (чистая машина состояний + тонкий сервис, атомарный условный UPDATE).
- Написан и одобрен дизайн-док `docs/sessions/2026-07-18-room-lifecycle-design.md`.
- Написан план реализации `docs/sessions/2026-07-18-room-lifecycle-implementation-plan.md` (`superpowers:writing-plans`): 7 TDD-задач. Ключевое решение по тестам — **Testcontainers** (эфемерный Postgres; гоняется локально и в CI; первый DB-тест в репозитории, станет переиспользуемым паттерном ядра).
- Владелец выбрал исполнение **subagent-driven, но в новой сессии** → эта сессия завершается на готовом плане.

### Коммиты этой сессии
- `2aa6844` docs(design): room lifecycle design — state machine slice (REQ-RT-005)
- `50f7fe7` docs(plan): room lifecycle implementation plan (REQ-RT-005, phase 1)
- (+ коммит этого HANDOFF)

### Локальное состояние (не в git)
- Ничего не запущено: писались только доки, рантайм/БД/Docker не поднимались.
- Рабочее дерево чистое (кроме HANDOFF на момент коммита).
- Ветка `phase-1-room-lifecycle` — локальная, не на `origin`.

### Осталось недоделанным
- Исполнить план (Task 1→7) в новой сессии через subagent-driven-development.
- Решить про push ветки (не делалось по умолчанию).
