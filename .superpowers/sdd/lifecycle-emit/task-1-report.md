# Task 1 Report: Prisma-схема `realtime` + миграция + presence-тест

## What was implemented

- `packages/core/prisma/schema.prisma`: добавлена схема `realtime` в `datasource db.schemas` (алфавитный порядок: `["identity", "realtime", "room"]`); добавлены enum `EventVisibility` (mapped-строки `public`/`organizer`/`module-private`, `@@schema("realtime")`) и модель `LogEvent` (`@@id([roomId, seq])`, оба relation с `onDelete: Restrict`, `recordedAt @default(now())`); обратные поля `logEvents LogEvent[]` в `Room` и `Identity` — всё по брифу verbatim.
- Миграция `packages/core/prisma/migrations/20260722180147_realtime_log_event/migration.sql` — сгенерирована `prisma migrate dev --name realtime_log_event` против эфемерного контейнера `mm-migrate` (postgres:17, порт 55432). Контейнер удалён после регенерации клиента (`docker rm -f mm-migrate`).
- Presence-тест `packages/core/src/realtime/log-event-schema.int-spec.ts` (4 теста: существование таблицы, составной PK, два Restrict-FK, контрактные строки enum).
- Клиент регенерирован явно (`prisma generate`); `LogEvent`/`logEvent` присутствуют в `.prisma/client/index.d.ts` (67 вхождений `logEvent`).

## TDD Evidence

### RED

Command: `pnpm --filter @mymozhem/core test:int -- log-event-schema` (до изменения схемы)

```
Test Suites: 1 failed, 1 total
Tests:       4 failed, 4 total
```

- Тест 1: `expected [].toHaveLength(1)` — таблицы `realtime."LogEvent"` нет.
- Тесты 2–3: `Raw query failed. Code: 42P01. Message: relation "realtime.LogEvent" does not exist`.
- Тест 4: enum-строки пусты (`Received: Array []`).

Ожидаемо: ни таблицы, ни enum ещё не существует.

### GREEN

Command: `pnpm --filter @mymozhem/core test:int -- log-event-schema` (после миграции + generate)

```
✓ exists in schema realtime (12 ms)
✓ has composite PK (roomId, seq) — unique(roomId, seq) of REQ-RT-001 (1 ms)
✓ has exactly two Restrict FKs to the core tables (REQ-CORE-003, no cascades)
✓ stores contract-string visibility values (module-private with a hyphen)
Tests: 4 passed, 4 total
```

Полная интеграционная лана: `pnpm --filter @mymozhem/core test:int` →
`Test Suites: 4 passed, 4 total; Tests: 25 passed, 25 total` (21 было + 4 новых), Time 17.9s. Регрессий нет.

## Generated migration SQL (full contents)

```sql
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "realtime";

-- CreateEnum
CREATE TYPE "realtime"."EventVisibility" AS ENUM ('public', 'organizer', 'module-private');

-- CreateTable
CREATE TABLE "realtime"."LogEvent" (
    "roomId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "actorId" UUID,
    "visibility" "realtime"."EventVisibility" NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogEvent_pkey" PRIMARY KEY ("roomId","seq")
);

-- AddForeignKey
ALTER TABLE "realtime"."LogEvent" ADD CONSTRAINT "LogEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "room"."Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realtime"."LogEvent" ADD CONSTRAINT "LogEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "identity"."Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

### Inspection checklist (проверено глазами, пункт за пунктом)

- [x] `CREATE SCHEMA IF NOT EXISTS "realtime";` — есть.
- [x] `CREATE TYPE "realtime"."EventVisibility" AS ENUM ('public', 'organizer', 'module-private');` — именно mapped-строки, не `PUBLIC`/`MODULE_PRIVATE`.
- [x] PK `PRIMARY KEY ("roomId","seq")` — составной, порядок колонок как в `@@id`.
- [x] Оба FK с `ON DELETE RESTRICT ON UPDATE CASCADE` — `LogEvent_roomId_fkey` → `room."Room"(id)`, `LogEvent_actorId_fkey` → `identity."Identity"(id)`.
- [x] `recordedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP` — есть.
- [x] Никаких изменений существующих таблиц `room."Room"` / `identity."Identity"` — в файле только CreateSchema/CreateEnum/CreateTable/два AddForeignKey; обратные relation-поля SQL не породили.

Править SQL не потребовалось — генерация совпала с чеклистом с первого раза.

## Files changed

- `packages/core/prisma/schema.prisma` (modified)
- `packages/core/prisma/migrations/20260722180147_realtime_log_event/migration.sql` (created)
- `packages/core/src/realtime/log-event-schema.int-spec.ts` (created)

Commit: `b5dee43 feat(core): realtime.LogEvent table + EventVisibility enum migration (REQ-RT-001)` (3 files, +121/-1). Не запушено.

## Self-review findings / deviations / concerns

1. **Отклонение от verbatim-теста брифа (единственное).** В PK-тесте бриф требовал `expect(constraintdef).toContain('"seq"')`. Это недостижимо: `pg_get_constraintdef` канонизирует идентификаторы и квотит только те, что нуждаются в квотировании; lowercase `seq` всегда рендерится без кавычек — фактический вывод `PRIMARY KEY ("roomId", seq)`. Первый GREEN-прогон упал ровно на этом (`Expected substring: "\"seq\"" / Received: "PRIMARY KEY (\"roomId\", seq)"`). Миграция при этом корректна (см. чеклист). Минимальная правка теста с сохранением намерения: заменено на точное сравнение `expect(rows[0].constraintdef).toBe('PRIMARY KEY ("roomId", seq)')` с комментарием-пояснением. После правки — 4/4 GREEN. Рекомендую учесть эту поправку в брифе для последующих сессий.
2. Дисциплина: никакого сервисного кода не добавлялось (это Task 2); `postgres.testcontainer.ts` не трогался; чужой контейнер `lt-pg` на 5432 не затрагивался; authoring-контейнер удалён.
3. `migrate dev` клиент не перегенерировал молча — клиент регенерирован отдельной командой `prisma generate`, как предписывал бриф; наличие `logEvent` в типах проверено grep'ом.
