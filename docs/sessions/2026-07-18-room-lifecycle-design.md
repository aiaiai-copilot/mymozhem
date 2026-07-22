# Дизайн — Room lifecycle (срез 1 арки Rooms)

**Статус:** одобрен владельцем 2026-07-18 (brainstorm-сессия). Вход для writing-plans.
**Этап:** MVP, фаза 1 (Ядро). Метод — AIDD / Specification-Driven.
**Отношение к другим документам:** реализует часть объёма фазы 1 (§5 нормативного пакета
v1.2) с учётом амендмента v1.3. Ссылается на дизайн ядра SDK-контракта
(`2026-07-16-sdk-contract-core-design.md`, §7 «точки принуждения»): Room — фундамент,
на который пинятся точки §7 #3–#5 (пин `(appId, manifestVersion)` при ACTIVE, фиксация
события, чтение проекции). Этот срез строит только фундамент.

---

## 0. Одно-абзацная рамка

Первый срез домена Room — **чистая машина жизненного цикла комнаты как CRUD-сущности**.
По ADR-005 полный event sourcing CRUD-доменов (комнаты, членство, реестр) избыточен:
Room — строка с колонкой `status` и явной машиной состояний (REQ-RT-005), а не
проекция из лога. Lifecycle-эмит в лог (REQ-RT-010) — аддитивное уведомление поверх,
вводится, когда появится Event Log. Срез намеренно узкий и глубоко тестируемый: он не
тянет вверх Identity (организатор, гости, токены) и вниз Event Log; авторизация «кто
переводит» и валидация содержимого — отдельные слои позже.

## 1. Объём и карта требований

**Закрывает (headline): REQ-RT-005** — переходы статуса ограничены явной машиной
состояний: `DRAFT → ACTIVE → COMPLETED`, `DRAFT → CANCELLED`, `ACTIVE → CANCELLED`;
иные переходы запрещены. Мягкое удаление — ортогональный атрибут `deletedAt`,
допустимый в `DRAFT / COMPLETED / CANCELLED`, но не в `ACTIVE`; удаление не является
статусом.

**Сопутствующе задействует:**
- REQ-CORE-002 — Room как один из доменов ядра (Identity, Room, Membership, Realtime,
  App-registry). Срез вводит домен Room.
- REQ-CORE-003 — каждый модуль владеет таблицами в отдельной PostgreSQL-схеме
  (Prisma `multiSchema`). Room живёт в схеме `room`. Декларативный FK из таблицы модуля
  на core-таблицу `identity` допускается без каскадов — задел под будущий `organizerId → identity.id`.
- REQ-CORE-004 — нет глобального мутабельного состояния процесса: чистый state-machine
  модуль без module-level мутабельного состояния; сервис — stateless поверх Prisma.
- REQ-CORE-006 — бизнес-логика в сервисах; в этом срезе транспортной обвязки
  (контроллеры/гейтвеи) нет вовсе.
- REQ-OPS-002 — миграция применяется детерминированно (`migrate deploy`); сид в
  production не попадает.
- REQ-DEV-001 — CI-гейты: lint (+ boundary-check), type-check, unit, сборка.

**Осознанно НЕ строит (швы фиксируются словами, не пустым кодом — CLAUDE.md §2 п.3):**
- **REQ-RT-010** (lifecycle-эмит перехода в лог как `public`-событие) — нет Event Log.
  Переходы пока не эмитятся; шов закрывается в плане Event Log / event-commit.
- **REQ-RT-004** (заморозка `appSettings` и пина `(appId, manifestVersion)` при ACTIVE) —
  следующий план (appSettings-write-path, §7 #2/#3 дизайна SDK), где есть чем
  замораживать и чем валидировать. Room-строка в этом срезе колонок `appSettings/appId/
  manifestVersion` **не несёт** — миграция аддитивна, колонки добавятся позже.
- **REQ-ID-005** (организатор = REGISTERED-identity) и FK `organizerId → identity.id` —
  нет таблицы Identity. `organizerId` — простая колонка (`@db.Uuid`), без FK и без
  REGISTERED-проверки.
- **Авторизация переходов** («кто вправе переводить комнату» — роли/членство) — нужен
  Membership/Identity. Сервис принуждает только легальность машины состояний, не право
  актора.
- **HTTP/REST-поверхность** организатора и маппинг ошибок в типизированный API-ответ
  (REQ-SEC-006) — нужен auth-контекст. В этом срезе — только сервис + персистентность.
- **REQ-ID-013 / REQ-ID-002** (код комнаты, политики входа) — домен Membership.
- **REQ-RT-016** (запечатывание лога в терминальном статусе) — event-commit план (нет лога).

## 2. Модель данных (Prisma, схема `room`)

Prisma 7.8.0: `multiSchema` — GA, preview-флаг не нужен. `partialIndexes` (REQ-DEV-006)
в этом срезе не участвует — частичных уникальных индексов у Room нет.

```prisma
// datasource: url приходит через @prisma/adapter-pg (как в фазе 0), + schemas
datasource db {
  provider = "postgresql"
  schemas  = ["room"]
}

enum RoomStatus {
  DRAFT
  ACTIVE
  COMPLETED
  CANCELLED
  @@schema("room")
}

model Room {
  id          String     @id @default(uuid()) @db.Uuid
  organizerId String     @db.Uuid                 // простая колонка; FK→identity + REGISTERED — отложено (REQ-ID-005)
  status      RoomStatus @default(DRAFT)
  deletedAt   DateTime?                            // ортогональный soft-delete (REQ-RT-005)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  @@schema("room")
}
```

- Первая реальная модель ядра ⇒ первая миграция (`prisma migrate dev` при разработке,
  `migrate deploy` при деплое — REQ-OPS-002). Устанавливает паттерн «схема-на-модуль».
- Индексы под чтение (напр. по `organizerId`) **не вводятся** — read-path в этом срезе
  нет; добавятся аддитивно вместе с ним.
- `@db.Uuid` у `organizerId` — задел под будущий декларативный FK на `identity.id`
  (REQ-CORE-003), вводимый без миграции данных.

## 3. Чистый модуль машины состояний (`room-state-machine.ts`)

Без зависимостей на Nest/Prisma — полностью юнит-тестируем в изоляции (глубокий узел):

```ts
type RoomStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

// allow-list переходов; COMPLETED и CANCELLED терминальны (нет исходящих)
const TRANSITIONS: ReadonlyArray<readonly [RoomStatus, RoomStatus]> = [
  ['DRAFT', 'ACTIVE'],
  ['DRAFT', 'CANCELLED'],
  ['ACTIVE', 'COMPLETED'],
  ['ACTIVE', 'CANCELLED'],
];

// бросает RoomTransitionError, если пары (from,to) нет в allow-list
function assertTransition(from: RoomStatus, to: RoomStatus): void;

// soft-delete разрешён ∈ {DRAFT, COMPLETED, CANCELLED}; ACTIVE → RoomTransitionError
function assertDeletable(status: RoomStatus): void;
```

Таблица — единственный источник истины по легальности; методы сервиса не дублируют
правил. `RoomStatus` — локальный доменный тип ядра (не из SDK: lifecycle-статус не
пересекает границу app↔core в этом срезе).

## 4. RoomService (персистентность + оркестрация)

Корректность конкуренции держится на **атомарном условном UPDATE**, а не на
read-then-write (CLAUDE.md §4: инвариант в БД, не проверка перед записью):

- `create(organizerId)` → INSERT со `status = DRAFT`. REGISTERED-проверка организатора
  отложена (REQ-ID-005, нет Identity).
- `transition(roomId, to)`:
  1. SELECT текущей строки. `null` → `ROOM_CONFLICT` (not-found свёрнут в конфликт).
  2. `assertTransition(from, to)` — при нелегальности `ROOM_TRANSITION_INVALID`.
  3. `UPDATE room SET status = :to WHERE id = :roomId AND status = :from AND deletedAt IS NULL`.
     Ноль затронутых строк → `ROOM_CONFLICT` (гонка / уже терминально / удалено).
  4. Удобные обёртки: `activate` / `complete` / `cancel`.
- `softDelete(roomId)`:
  1. SELECT. `null` → `ROOM_CONFLICT`.
  2. `assertDeletable(status)` — при нарушении (ACTIVE) `ROOM_TRANSITION_INVALID`.
  3. `UPDATE room SET deletedAt = now() WHERE id = :roomId AND deletedAt IS NULL AND status IN DELETABLE_STATUSES`.
     Guard выводится из `DELETABLE_STATUSES` (§3 — единственный источник истины), а не
     дублирует правило литералом `status <> 'ACTIVE'`. Ноль строк → `ROOM_CONFLICT`.

SELECT существует **только** ради точного разделения «нелегальный переход существующей
комнаты» vs «конфликт»; атомарность и корректность гонки держит `WHERE`-условие
единственного UPDATE, а не прочитанное значение (TOCTOU между SELECT и UPDATE безопасен:
устаревший `from` в `WHERE` даёт ноль строк → `ROOM_CONFLICT`). Soft-deleted комната
инертна — она вне `deletedAt IS NULL`, любой переход даёт ноль строк.

## 5. Обработка ошибок

Core-внутренние типизированные доменные ошибки со стабильным `code` — **не в SDK**: они
не пересекают границу app↔core (это область контрактных кодов §8 дизайна SDK). Две штуки:

- `ROOM_TRANSITION_INVALID` — нарушение машины состояний (нелегальный переход либо
  удаление в `ACTIVE`).
- `ROOM_CONFLICT` — атомарный UPDATE затронул ноль строк: not-found, гонка конкурирующих
  переходов, уже терминальный статус или уже удалено.

**Шов (REQ-SEC-006):** при появлении HTTP-поверхности организатора эти коды маппятся в
типизированный API-ответ без внутренних сообщений и стектрейсов. Фиксируется словами.

## 6. Обвязка модуля

- `RoomModule` (Nest) предоставляет `RoomService`, импортирует `PrismaModule`.
- Экспорт из `@mymozhem/core` (`packages/core/src/index.ts`); регистрация в
  `apps/server/src/app.module.ts` рядом с `AppRegistryModule` / `HealthModule`.
- Чистый state-machine модуль зависимостей на Nest/Prisma не имеет — импортируется и
  тестируется отдельно.
- boundary-check (dependency-cruiser) остаётся зелёным: `RoomService → PrismaService` —
  тот же внутренний паттерн ядра, что и существующие модули; SDK здесь не задействован.

## 7. Стратегия тестов (TDD, RED → GREEN — тесты первыми)

**Unit (ноль БД) — `room-state-machine`:**
- каждый из 4 легальных переходов разрешён;
- представительный набор нелегальных отклонён (`COMPLETED→ACTIVE`, `DRAFT→COMPLETED`,
  `CANCELLED→*`, `ACTIVE→DRAFT`, самопереходы);
- `assertDeletable` по каждому статусу (ACTIVE отклонён, прочие разрешены).

**Интеграционные (реальная БД — критерий выхода фазы 1 «интеграционные тесты ядра»):**
- `create` → строка со `status = DRAFT`;
- каждый легальный переход персистится;
- нелегальный переход → `ROOM_TRANSITION_INVALID`;
- терминальный статус (`COMPLETED`/`CANCELLED`) отклоняет дальнейшие переходы;
- soft-delete разрешён в `DRAFT`/`COMPLETED`/`CANCELLED`, отклонён в `ACTIVE`
  (`ROOM_TRANSITION_INVALID`);
- **конкурентные конкурирующие переходы** (`DRAFT→ACTIVE` vs `DRAFT→CANCELLED` над одной
  комнатой) — ровно один побеждает, второй получает `ROOM_CONFLICT` (доказывает
  атомарность условного UPDATE).

## 8. Отклонённые альтернативы (обоснование решений)

- **appSettings/пин/заморозка в этом срезе** — отклонено. Инвариант заморозки REQ-RT-004
  тестируем и осмыслен только вместе с write-path; принуждать «нет мутации после ACTIVE»
  над полем, которое никто не пишет, — правило над мёртвой колонкой. Аддитивная миграция
  позже дешевле. Срез остаётся чистой машиной состояний.
- **organizerId с FK и REGISTERED-проверкой сейчас** — отклонено: нет таблицы Identity;
  тянуть Identity вперёд его собственного проектирования — вскипятить океан. Простая
  `@db.Uuid`-колонка + шов словами.
- **Ошибка перехода в SDK** — отклонено: lifecycle-переход не пересекает границу
  app↔core (это не событие контракта). Core-внутренняя доменная ошибка; выравнивание с
  API-таксономией — при появлении HTTP.
- **Логика переходов инлайн в сервисе (Подход 2)** — отклонено: сцепляет правила машины
  с персистентностью, хуже тестируется изолированно.
- **Generic state-machine библиотека (xstate, Подход 3)** — отклонено: оверкилл на
  4 состояния / 4 перехода, лишняя зависимость и косвенность (YAGNI).
- **read-then-write для переходов** — отклонено в пользу атомарного условного UPDATE:
  read-then-write допускает гонку между проверкой и записью; `WHERE status = :from`
  делает переход payload-нейтрально атомарным на уровне БД (та же философия, что
  REQ-RWD-010).

## 9. Критерии выхода среза и ревью

**Критерии выхода:** все тесты §7 зелёные; CI-гейты зелёные (lint + boundary-check,
type-check, unit/integration, сборка — REQ-DEV-001); первая миграция схемы `room`
применяется чисто; экспорт `RoomModule`/`RoomService` из `@mymozhem/core`
зарегистрирован в сервере.

**Двухстадийное ревью (CLAUDE.md §3):** стадия 1 (спек-комплаенс) сверяется против
перечисленных REQ-* из §1 — headline **REQ-RT-005** и сопутствующие REQ-CORE-002/003/004/006,
REQ-OPS-002; стадия 2 — качество кода.

## 10. Швы (отложенное, зафиксированное словами)

| Шов | Требование | Закрывается в |
|---|---|---|
| Lifecycle-эмит перехода в лог (`public`) | REQ-RT-010 | план Event Log / event-commit |
| Заморозка appSettings + пин `(appId, manifestVersion)` при ACTIVE | REQ-RT-004 | appSettings-write-path (§7 #2/#3) |
| FK `organizerId → identity.id` + организатор = REGISTERED | REQ-CORE-003, REQ-ID-005 | план Identity |
| Авторизация переходов (роли/членство) | REQ-ID-011 и др. | план Membership |
| HTTP-поверхность + маппинг ошибок в API (без стектрейсов) | REQ-SEC-006 | план с auth |
| Код комнаты, политики входа | REQ-ID-013, REQ-ID-002 | план Membership |
| Запечатывание лога в терминальном статусе | REQ-RT-016 | event-commit план |
