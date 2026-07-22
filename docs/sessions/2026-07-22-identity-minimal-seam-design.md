# Дизайн: Identity minimal seam (REQ-ID-005 + REQ-ID-001)

**Дата:** 2026-07-22
**Статус:** одобрен владельцем по секциям (объём+модель, принуждение+SDK+тесты)
**Предшественники:** Room lifecycle (2026-07-18), SDK contract core (2026-07-16)

Срез снимает заглушку `organizerId` как «просто UUID»: вводит таблицу identity,
декларативный FK и принуждение «организатор — только REGISTERED». Это минимальный
шов: никаких потоков (вход, OAuth, токены, membership) — только структура и
инвариант, на который они встанут.

---

## 1. Объём

**Закрывает:**

- **REQ-ID-005 (MUST)** — организатором комнаты может быть только REGISTERED-identity.
- **REQ-ID-001 (MUST)** — единая таблица identity с `kind ∈ {REGISTERED, GUEST}`,
  nullable `email`, частичный уникальный индекс; реализация индекса — SQL-миграцией
  с автотестом наличия (REQ-DEV-006, без preview-функции Prisma `partialIndexes`).
- Попутно: контрактный словарь SDK — `identityKindSchema` и `memberRoleSchema`
  (REQ-ID-011) — без потребителей пока; фиксирует лексикон до того, как он
  расползётся литералами (membership, JWT-claims, `draw_eligibility` опираются на
  эти значения).

**Сознательно НЕ входит (швы, §6):** membership-таблица и join-потоки, гостевой
вход (REQ-ID-002/003/013), OAuth (REQ-ID-015), токены (REQ-ID-007/008/016),
kind-флип (REQ-ID-004/017 — отложен амендментом v1.3 за первое событие),
TTL/анонимизация как поток (REQ-ID-003/014), `displayName` и provider-данные
(появятся с первым потоком, которому они нужны).

## 2. Модель данных и миграция

Новая PostgreSQL-схема `identity` (ADR-006: схема на модуль). `datasource.schemas`
становится `["room", "identity"]`.

```prisma
enum IdentityKind {
  REGISTERED
  GUEST
  @@schema("identity")
}

model Identity {
  id        String       @id @default(uuid()) @db.Uuid
  kind      IdentityKind
  email     String?
  deletedAt DateTime?    // REQ-ID-014: анонимизация обнуляет PII, id остаётся
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt
  @@schema("identity")
}
```

Частичный уникальный индекс — SQL-миграцией (REQ-DEV-006):

```sql
CREATE UNIQUE INDEX "Identity_registered_email_key"
  ON "identity"."Identity" (lower("email"))
  WHERE "kind" = 'REGISTERED' AND "deletedAt" IS NULL;
```

`lower()` обязателен: email регистронезависим, иначе индекс обходится сменой
регистра. Условие `deletedAt IS NULL` — из REQ-ID-001: анонимизированная identity
освобождает email для повторной регистрации.

FK `room."Room"."organizerId" → identity."Identity"."id"` — той же миграцией.

⚠️ **Эксплуатационная заметка:** на локальной dev-БД, где уже есть комнаты со
случайными `organizerId`, миграция упадёт на добавлении FK. Персистентных данных
не существует (только эфемерные контейнеры и локальные dev-БД) — рецепт:
`prisma migrate reset`.

## 3. Принуждение REQ-ID-005 — guarded INSERT

`RoomService.create` больше не принимает UUID вслепую. Вставка — один атомарный
оператор (Prisma tagged-template `$queryRaw`, параметризовано, `RETURNING *`
отдаёт созданную строку):

```sql
INSERT INTO "room"."Room" ("id", "organizerId", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), $1, 'DRAFT', now(), now()
WHERE EXISTS (
  SELECT 1 FROM "identity"."Identity"
  WHERE "id" = $1 AND "kind" = 'REGISTERED' AND "deletedAt" IS NULL
)
RETURNING *;
```

(`updatedAt` обязан быть в списке колонок: `@updatedAt` заполняет Prisma на
клиенте, DB-дефолта у колонки нет.)

Ноль строк → `ROOM_ORGANIZER_NOT_REGISTERED` (core-внутренняя типизированная
ошибка в `room.errors.ts`, рядом с существующими). Сознательно **свёрнуты** в
один код: «identity не существует», «identity — GUEST», «identity удалена». Для
вызывающего это один и тот же отказ; предикат — инвариант identity, а не место
для разведки различий. Pre-SELECT «для точности ошибки» не делается: предикат в
SQL — единственный источник истины (та же философия, что guarded UPDATE в
Rooms, REQ-RT-005).

**Почему это race-safe структурно, а не статистически:** в фазе 1 `kind`
иммутабелен (kind-флип вынесен амендментом v1.3 за первое событие); когда flow
появится, флип идёт только GUEST→REGISTERED, никогда обратно (REQ-ID-004);
`deletedAt` для REGISTERED на этом этапе не выставляется ни одним потоком
(анонимизация по TTL — про гостей, REQ-ID-014). Значит, проверенное в `WHERE
EXISTS` значение не устаревает между проверкой и вставкой — а сама проверка и
вставка атомарны одним оператором.

**Отклонённая альтернатива — триггер БД** (развилка закрыта владельцем
2026-07-22): `BEFORE INSERT/UPDATE`-триггер держал бы инвариант даже против
писателя мимо сервиса, но такого актора на этапе нет — по фильтру амендмента
v1.3 это задел, добавляемый позже чисто аддитивной миграцией. CHECK здесь
неприменим: Postgres не допускает подзапрос к другой таблице в CHECK.

## 4. SDK-поверхность

Два контрактных словаря, без потребителей в этом срезе:

- `identityKindSchema = z.enum(['REGISTERED', 'GUEST'])` (REQ-ID-001);
- `memberRoleSchema = z.enum(['ORGANIZER', 'MODERATOR', 'PARTICIPANT', 'SPECTATOR'])`
  (REQ-ID-011; MODERATOR до ф.4 не имеет прав сверх PARTICIPANT — амендмент v1.3,
  но значение в перечислении остаётся).

Фикстуры и контрактные тесты по домашнему стилю (REQ-CTR-005): валидные значения
принимаются, невалидные (`'ADMIN'`, `'guest'` в нижнем регистре, пустая строка)
отклоняются. PII-проекция identity в SDK **не** переносится — нет читателя.

## 5. Тесты (Testcontainers-лана, паттерн `postgres.testcontainer.ts`)

Тесты сидят identity напрямую через Prisma-клиент (`IdentityService` не
существует — §6).

- **create room:** REGISTERED-организатор → успех; GUEST-организатор →
  `ROOM_ORGANIZER_NOT_REGISTERED`; несуществующий UUID → тот же код; identity с
  `deletedAt` → тот же код.
- **Частичный индекс (REQ-ID-001 / REQ-DEV-006):** автотест наличия индекса через
  `pg_indexes` (имя + предикат); два REGISTERED с одним email → unique-нарушение;
  тот же email у двух GUEST → ок; тот же email у REGISTERED с `deletedAt` → ок;
  email, отличающийся только регистром → нарушение (`lower()`).
- **FK:** raw-вставка комнаты со случайным `organizerId` в обход сервиса →
  FK-нарушение.
- **SDK:** контрактные тесты двух enum'ов по фикстурам.

## 6. Сознательно не построенные швы (не начинать молча)

- **`IdentityService` / потоки создания identity** — гостевой вход
  (REQ-ID-002/003/013), OAuth-provisioning (REQ-ID-015). Первый поток заведёт
  сервис сам; до тех пор identity пишется только из тестов через Prisma-клиент.
- **Membership-таблица и ролевая матрица** (REQ-ID-011/012) — SDK-перечисление
  ролей есть, сущности нет.
- **Токены** (REQ-ID-007/008/016) и **kind-флип** (REQ-ID-004/017) — за первым
  событием по амендменту v1.3.
- **TTL гостя и анонимизация-поток** (REQ-ID-003/014) — колонка `deletedAt` есть,
  потока нет.
- **`displayName`, provider-данные** (REQ-ID-015) — появятся с первым потоком,
  которому нужны (гостевой вход / OAuth).
- **Триггер БД на kind-предикат** — задел, §3.
- **PII-проекция identity в SDK** — с первым читателем.

## 7. Долгоживущие ограничения, вводимые срезом

- Миграция identity + FK **замораживается** после слияния (прецедент: правка на
  месте допустима только до применения к постоянной БД и до публикации ветки).
- Предикат «REGISTERED и не удалена» живёт в guarded INSERT `RoomService.create`
  и в условии индекса — два места, одно правило. Изменение правила (например,
  новые состояния identity) требует пересмотра обоих; задел под триггер (§3)
  схлопнул бы их в одно.
