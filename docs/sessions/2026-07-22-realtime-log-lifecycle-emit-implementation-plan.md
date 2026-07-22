# Lifecycle Log Emit (Event Log фундамент) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить append-only лог событий комнаты (таблица `realtime."LogEvent"`, append-примитив `EventLogService.commitCoreEvent`) и подключить к нему переходы `COMPLETED`/`CANCELLED` как `public`-события в одной транзакции с переходом (REQ-RT-010 2/3, REQ-RT-001, REQ-RT-007, REQ-DEV-008).

**Architecture:** Спека: `docs/sessions/2026-07-22-realtime-log-lifecycle-emit-design.md`. Лог — часть домена Realtime (ADR-003): модуль `packages/core/src/realtime/`, PostgreSQL-схема `realtime`. seq назначается в критической секции `pg_advisory_xact_lock` одним statement'ом `INSERT … SELECT COALESCE(MAX(seq),0)+1`; zod-валидация payload — ДО входа в секцию (SDK-дизайн §7, REQ-RT-007). `RoomService.transition` переезжает в `prisma.$transaction`: guarded UPDATE + emit атомарны (fail-closed, REQ-DEV-008). Эмит `room.activated` — осознанный шов в appSettings-срез (payload = пин REQ-RT-004, ему неоткуда взяться).

**Tech Stack:** NestJS 11, Prisma 7.8 (adapter-pg, multiSchema), zod 4 (через `@mymozhem/sdk`), Jest + Testcontainers (интеграционная лана), dependency-cruiser.

## Global Constraints

- **Спека-источник:** `docs/sessions/2026-07-22-realtime-log-lifecycle-emit-design.md` (§1 — карта REQ-*, §10 — швы). Расхождение плана со спекой = баг плана или стоп для владельца.
- **Prisma 7.8 закреплена; preview-фичи запрещены** (REQ-DEV-006 касается partial indexes — здесь не нужны). Миграции — только `prisma migrate dev` с эфемерного authoring-контейнера + ручная инспекция SQL; после слияния миграция **заморожена** (прецедент: `room_lifecycle`, `identity_seam`, `room_organizer_fk`).
- **Хост-порт 5432 занят чужим контейнером `lt-pg` — НЕ трогать.** Authoring-контейнер `mm-migrate` публиковать на порт 55432, после авторинга удалить (`docker rm -f mm-migrate`).
- **`pnpm exec prisma generate` требует `DATABASE_URL` и cwd = корень репозитория** (обнаружение `prisma.config.ts`); `migrate dev` не всегда регенерирует клиент — generate запускать явно.
- **Контрактные строки:** тип события `core.room.completed` / `core.room.cancelled` (форма `eventTypeSchema`); значения visibility в БД — `'public' | 'organizer' | 'module-private'` (Prisma enum с `@map`).
- **FK-прецедент:** `ON DELETE RESTRICT ON UPDATE CASCADE` (как `Room_organizerId_fkey`); для опционального `actorId` `onDelete: Restrict` указать ЯВНО (дефолт Prisma для optional — SetNull).
- **Интеграционная лана:** `maxWorkers: 1`, Docker Desktop запущен, ~8–15 с на файл; тесты бьют только по одноразовым контейнерам (`packages/core/src/testing/postgres.testcontainer.ts`), никогда не против внешней БД.
- **Никаких новых зависимостей.** SDK уже экспортирует `CORE_EVENTS`, `CoreEventName`, `coreEventType`, `ContractError` (`@mymozhem/sdk`).
- **Коммиты:** conventional с REQ-тегами; трейлер `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Пуш НЕ выполнять (9 коммитов уже ждут решения владельца).

---

### Task 1: Prisma-схема `realtime` + миграция + presence-тест

**Files:**
- Modify: `packages/core/prisma/schema.prisma`
- Create: `packages/core/prisma/migrations/<timestamp>_realtime_log_event/migration.sql` (генерируется `migrate dev`)
- Test: `packages/core/src/realtime/log-event-schema.int-spec.ts` (создать)

**Interfaces:**
- Consumes: существующие модели `Room` (схема `room`), `Identity` (схема `identity`).
- Produces (для Task 2–3): таблица `realtime."LogEvent"` (колонки `roomId uuid, seq int, type text, payload jsonb, actorId uuid NULL, visibility realtime."EventVisibility", schemaVersion int, recordedAt timestamp DEFAULT now()`; PK `(roomId, seq)`; FK `LogEvent_roomId_fkey` → `room."Room"(id)`, `LogEvent_actorId_fkey` → `identity."Identity"(id)`, оба `ON DELETE RESTRICT`); enum `realtime."EventVisibility"` со значениями `'public','organizer','module-private'`; сгенерированный клиент: `prisma.logEvent`, тип `LogEvent`, `Prisma.TransactionClient`.

- [ ] **Step 1: Написать падающий presence-тест миграции**

Создать `packages/core/src/realtime/log-event-schema.int-spec.ts`:

```ts
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';

// REQ-RT-001: таблица append-only лога существует в мигрированной БД с контрактной
// формой — составной PK (roomId, seq) [= unique(roomId, seq)], Restrict FK на
// core-таблицы без каскадов (REQ-CORE-003), контрактные строки visibility.
describe('Realtime LogEvent table (migration presence)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  it('exists in schema realtime', async () => {
    const rows = await db.prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'realtime' AND tablename = 'LogEvent'
    `;
    expect(rows).toHaveLength(1);
  });

  it('has composite PK (roomId, seq) — unique(roomId, seq) of REQ-RT-001', async () => {
    const rows = await db.prisma.$queryRaw<{ constraintdef: string }[]>`
      SELECT pg_get_constraintdef(oid) AS constraintdef
      FROM pg_constraint
      WHERE conrelid = 'realtime."LogEvent"'::regclass AND contype = 'p'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].constraintdef).toContain('"roomId"');
    expect(rows[0].constraintdef).toContain('"seq"');
  });

  it('has exactly two Restrict FKs to the core tables (REQ-CORE-003, no cascades)', async () => {
    const rows = await db.prisma.$queryRaw<{ conname: string; constraintdef: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS constraintdef
      FROM pg_constraint
      WHERE conrelid = 'realtime."LogEvent"'::regclass AND contype = 'f'
      ORDER BY conname
    `;
    expect(rows.map((r) => r.conname)).toEqual([
      'LogEvent_actorId_fkey',
      'LogEvent_roomId_fkey',
    ]);
    for (const row of rows) {
      expect(row.constraintdef).toContain('ON DELETE RESTRICT');
    }
  });

  it('stores contract-string visibility values (module-private with a hyphen)', async () => {
    const rows = await db.prisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'realtime' AND t.typname = 'EventVisibility'
      ORDER BY e.enumsortorder
    `;
    expect(rows.map((r) => r.enumlabel)).toEqual(['public', 'organizer', 'module-private']);
  });
});
```

- [ ] **Step 2: Прогнать тест — убедиться, что падает (RED)**

Run: `pnpm --filter @mymozhem/core test:int -- log-event-schema`
Expected: FAIL — первый тест: `expected [].toHaveLength(1)` (таблицы нет). Остальные тесты падают с `relation "realtime.LogEvent" does not exist` — это нормальный RED.

- [ ] **Step 3: Обновить `packages/core/prisma/schema.prisma`**

В `datasource db` добавить схему (алфавитный порядок):

```prisma
datasource db {
  provider = "postgresql"
  schemas  = ["identity", "realtime", "room"]
}
```

Добавить enum и модель в конец файла:

```prisma
enum EventVisibility {
  PUBLIC         @map("public")
  ORGANIZER      @map("organizer")
  MODULE_PRIVATE @map("module-private")

  @@schema("realtime")
}

// Append-only лог событий комнаты (REQ-RT-001, ADR-005). Составной PK = unique(roomId, seq).
// seq назначает сервер в критической секции (advisory lock, REQ-RT-007).
// recordedAt — storage-only колонка (отладка/ретеншн); в контракт (logEventSchema) не
// входит и наружу не проецируется (design §2). onDelete: Restrict у actorId указан явно:
// дефолт Prisma для optional-релейшна — SetNull, а норма — Restrict (REQ-CORE-003).
model LogEvent {
  roomId        String          @db.Uuid
  seq           Int
  type          String
  payload       Json
  actorId       String?         @db.Uuid
  visibility    EventVisibility
  schemaVersion Int
  recordedAt    DateTime        @default(now())
  room          Room            @relation(fields: [roomId], references: [id], onDelete: Restrict)
  actor         Identity?       @relation(fields: [actorId], references: [id], onDelete: Restrict)

  @@id([roomId, seq])
  @@schema("realtime")
}
```

В модель `Room` добавить обратное поле (после `updatedAt`):

```prisma
  logEvents   LogEvent[]
```

В модель `Identity` добавить обратное поле (после `rooms Room[]`):

```prisma
  logEvents LogEvent[]
```

- [ ] **Step 4: Поднять authoring-контейнер и сгенерировать миграцию**

```bash
docker run -d --name mm-migrate -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
until docker exec mm-migrate pg_isready -U postgres | grep -q "accepting connections"; do sleep 1; done
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres pnpm exec prisma migrate dev --name realtime_log_event
```

Expected: миграция создана и применена; в `packages/core/prisma/migrations/` появилась новая директория `<timestamp>_realtime_log_event`.

- [ ] **Step 5: Ручная инспекция сгенерированного SQL**

Run: `cat packages/core/prisma/migrations/<timestamp>_realtime_log_event/migration.sql`
Expected (проверить глазами, при расхождении — править SQL миграции до применения в тестах, НЕ трогая уже применённую в authoring-БД — пересоздать контейнер и `migrate reset`):
- `CREATE SCHEMA IF NOT EXISTS "realtime";`
- `CREATE TYPE "realtime"."EventVisibility" AS ENUM ('public', 'organizer', 'module-private');` — именно mapped-строки, НЕ `PUBLIC`/`MODULE_PRIVATE`;
- PK `PRIMARY KEY ("roomId","seq")`;
- оба FK с `ON DELETE RESTRICT ON UPDATE CASCADE`;
- `recordedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`;
- НИКАКИХ изменений существующих таблиц `room."Room"` / `identity."Identity"` (обратные relation-поля — виртуальны, SQL не порождают).

- [ ] **Step 6: Явно регенерировать клиент**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres pnpm exec prisma generate
```

Expected: клиент сгенерирован без ошибок. Проверка: `grep -c "LogEvent" packages/core/node_modules/.prisma/client/*.d.ts` или `node_modules/.pnpm` — достаточно, что `pnpm --filter @mymozhem/core typecheck` после Task 2 видит `prisma.logEvent`. Удалить контейнер: `docker rm -f mm-migrate`.

- [ ] **Step 7: Прогнать presence-тест — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- log-event-schema`
Expected: PASS 4/4 (migrate deploy в testcontainer применяет новую миграцию).

- [ ] **Step 8: Прогнать всю интеграционную лану — регрессии нет**

Run: `pnpm --filter @mymozhem/core test:int`
Expected: PASS всех файлов (было 21 тест + 4 новых = 25). `TRUNCATE ... CASCADE` в существующих спеках теперь заодно чистит `realtime."LogEvent"` — это корректно.

- [ ] **Step 9: Commit**

```bash
git add packages/core/prisma packages/core/src/realtime/log-event-schema.int-spec.ts
git commit -m "feat(core): realtime.LogEvent table + EventVisibility enum migration (REQ-RT-001)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: EventLogService.commitCoreEvent + RealtimeModule + readRoomLog

**Files:**
- Create: `packages/core/src/realtime/event-log.service.ts`
- Create: `packages/core/src/realtime/realtime.module.ts`
- Create: `packages/core/src/testing/read-room-log.ts`
- Test: `packages/core/src/realtime/event-log.int-spec.ts` (создать)

**Interfaces:**
- Consumes: таблица/enum из Task 1; `CORE_EVENTS`, `CoreEventName`, `coreEventType`, `ContractError` из `@mymozhem/sdk`; `RoomService` (пока со старым конструктором `new RoomService(db.prisma)` — меняется только в Task 3); `seedIdentity`.
- Produces (для Task 3): `class EventLogService` с методом `commitCoreEvent(tx: Prisma.TransactionClient, roomId: string, name: CoreEventName, payload?: unknown, actorId?: string | null): Promise<LogEvent>`; `class RealtimeModule` (providers+exports: `[EventLogService]`, без импорта PrismaModule — транзакционный клиент приходит параметром); `readRoomLog(prisma: PrismaService, roomId: string): Promise<RoomLogRow[]>`.

- [ ] **Step 1: Написать падающие тесты примитива (RED)**

Создать `packages/core/src/realtime/event-log.int-spec.ts`:

```ts
import { ContractError } from '@mymozhem/sdk';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { readRoomLog } from '../testing/read-room-log';
import { RoomService } from '../room/room.service';
import { EventLogService } from './event-log.service';

const ORG = '00000000-0000-0000-0000-000000000001';

describe('EventLogService.commitCoreEvent', () => {
  let db: TestDb;
  let rooms: RoomService;
  let eventLog: EventLogService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    rooms = new RoomService(db.prisma);
    eventLog = new EventLogService();
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    // CASCADE чистит и realtime."LogEvent" (FK-ссылка), и room."Room".
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  it('commits one event with the contract shape (REQ-RT-001)', async () => {
    const room = await rooms.create(ORG);
    await db.prisma.$transaction((tx) =>
      eventLog.commitCoreEvent(tx, room.id, 'room.completed', {}),
    );

    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      seq: 1,
      type: 'core.room.completed',
      visibility: 'public', // REQ-RT-010
      actorId: null, // lifecycle/system — auth-контекста ещё нет
      payload: {},
      schemaVersion: 1,
    });
  });

  it('assigns dense per-room seq, independent across rooms', async () => {
    const a = await rooms.create(ORG);
    const b = await rooms.create(ORG);
    await db.prisma.$transaction((tx) => eventLog.commitCoreEvent(tx, a.id, 'room.completed', {}));
    await db.prisma.$transaction((tx) => eventLog.commitCoreEvent(tx, a.id, 'room.cancelled', {}));
    await db.prisma.$transaction((tx) => eventLog.commitCoreEvent(tx, b.id, 'room.cancelled', {}));

    expect((await readRoomLog(db.prisma, a.id)).map((e) => e.seq)).toEqual([1, 2]);
    expect((await readRoomLog(db.prisma, b.id)).map((e) => e.seq)).toEqual([1]);
  });

  it('rejects a payload mismatch with EVENT_PAYLOAD_INVALID and writes nothing', async () => {
    const room = await rooms.create(ORG);
    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitCoreEvent(tx, room.id, 'room.completed', { bogus: 1 }),
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ContractError);
    expect((err as ContractError).code).toBe('EVENT_PAYLOAD_INVALID');
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);
  });

  it('serializes concurrent commits via the advisory lock: dense seqs 1..N (REQ-RT-007)', async () => {
    const room = await rooms.create(ORG);
    const N = 8;

    const committed = await Promise.all(
      Array.from({ length: N }, () =>
        db.prisma.$transaction((tx) =>
          eventLog.commitCoreEvent(tx, room.id, 'room.cancelled', {}),
        ),
      ),
    );

    // Детерминированное свойство, не статистика: все коммиты успешны,
    // seq — ровно множество {1..N} без дублей.
    expect(new Set(committed.map((e) => e.seq))).toEqual(
      new Set(Array.from({ length: N }, (_, i) => i + 1)),
    );
    expect((await readRoomLog(db.prisma, room.id)).map((e) => e.seq)).toEqual(
      Array.from({ length: N }, (_, i) => i + 1),
    );
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что не компилируется/падает (RED)**

Run: `pnpm --filter @mymozhem/core test:int -- event-log.int-spec`
Expected: FAIL на этапе компиляции ts-jest — `Cannot find module './event-log.service'` / `'../testing/read-room-log'`. Это нормальный RED для TDD на новый модуль.

- [ ] **Step 3: Создать тест-хелпер `packages/core/src/testing/read-room-log.ts`**

```ts
import type { PrismaService } from '../prisma/prisma.service';

export type RoomLogRow = {
  roomId: string;
  seq: number;
  type: string;
  payload: unknown;
  actorId: string | null;
  visibility: string;
  schemaVersion: number;
};

// Сырой читатель лога в его storage- (= контрактной) форме: enum как text, payload как
// JSON. Тестовый хелпер: read-path сервиса в ядре осознанно нет (design §10 — шов
// realtime read плана), тесты читают таблицу напрямую.
export function readRoomLog(prisma: PrismaService, roomId: string): Promise<RoomLogRow[]> {
  return prisma.$queryRaw<RoomLogRow[]>`
    SELECT "roomId", "seq", "type", "payload", "actorId",
           "visibility"::text AS "visibility", "schemaVersion"
    FROM realtime."LogEvent"
    WHERE "roomId" = ${roomId}::uuid
    ORDER BY "seq"
  `;
}
```

- [ ] **Step 4: Создать `packages/core/src/realtime/event-log.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import type { LogEvent, Prisma } from '@prisma/client';
import { CORE_EVENTS, ContractError, coreEventType, type CoreEventName } from '@mymozhem/sdk';

// Append-only commit-примитив для core-типов событий (design §3). ЕДИНСТВЕННЫЙ путь
// записи в realtime."LogEvent". Порядок шагов контрактуален (SDK-дизайн §7):
// валидация payload — ДО входа в критическую секцию, затем advisory lock на комнату
// и атомарное присвоение seq — размер payload не влияет на исход гонки (REQ-RT-007).
// Шаги 1–7 цепочки app-событий (sealing REQ-RT-016, размер REQ-RT-012, rate-limit
// REQ-RT-014, actorId из auth REQ-RT-009, реестр REQ-CTR-008) встают перед шагом 3
// без изменения шагов 3–4 — шов event-commit плана (design §10).
@Injectable()
export class EventLogService {
  async commitCoreEvent(
    tx: Prisma.TransactionClient,
    roomId: string,
    name: CoreEventName,
    payload: unknown = {},
    actorId: string | null = null,
  ): Promise<LogEvent> {
    const definition = CORE_EVENTS[name];
    const parsed = definition.schema.safeParse(payload);
    if (!parsed.success) {
      throw new ContractError(
        'EVENT_PAYLOAD_INVALID',
        `payload of ${coreEventType(name)} does not match its core schema`,
      );
    }
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${roomId}, 0))`;
    const rows = await tx.$queryRaw<LogEvent[]>`
      INSERT INTO realtime."LogEvent"
        ("roomId", "seq", "type", "payload", "actorId", "visibility", "schemaVersion")
      SELECT ${roomId}::uuid,
             COALESCE(MAX("seq"), 0) + 1,
             ${coreEventType(name)},
             ${JSON.stringify(parsed.data)}::jsonb,
             ${actorId}::uuid,
             ${definition.visibility}::realtime."EventVisibility",
             ${definition.version}
      FROM realtime."LogEvent"
      WHERE "roomId" = ${roomId}::uuid
      RETURNING *
    `;
    return rows[0];
  }
}
```

- [ ] **Step 5: Создать `packages/core/src/realtime/realtime.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { EventLogService } from './event-log.service';

// PrismaModule намеренно НЕ импортируется: примитив работает на транзакционном
// клиенте вызывающего (атомарность «действие + лог», REQ-DEV-008).
@Module({
  providers: [EventLogService],
  exports: [EventLogService],
})
export class RealtimeModule {}
```

- [ ] **Step 6: Прогнать тесты примитива — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- event-log.int-spec`
Expected: PASS 4/4 (включая гонку 8 параллельных коммитов с плотными seq).

- [ ] **Step 7: Typecheck + lint пакета**

Run: `pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core lint`
Expected: чисто (0 errors).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/realtime packages/core/src/testing/read-room-log.ts
git commit -m "feat(core): EventLogService.commitCoreEvent primitive + RealtimeModule (REQ-RT-001, REQ-RT-007)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: RoomService.transition в транзакцию + lifecycle-эмит (REQ-RT-010)

**Files:**
- Modify: `packages/core/src/room/room.service.ts` (конструктор + `transition`)
- Modify: `packages/core/src/room/room.module.ts` (импорт RealtimeModule)
- Test: `packages/core/src/room/room.service.int-spec.ts` (обновить 3 call-site конструктора + новый describe)

**Interfaces:**
- Consumes: `EventLogService.commitCoreEvent(tx, roomId, name, payload?)` и `readRoomLog` из Task 2; `CoreEventName` из `@mymozhem/sdk`.
- Produces: `RoomService` с конструктором `(prisma: PrismaService, eventLog: EventLogService)` — публичные сигнатуры `create/transition/activate/complete/cancel/softDelete` НЕ меняются. Побочный эффект: успешный переход в `COMPLETED`/`CANCELLED` пишет ровно одну строку в `realtime."LogEvent"` в той же транзакции; `ACTIVE` не эмитит (шов, design §0 п.1).

- [ ] **Step 1: Обновить call-sites конструктора в существующих тестах**

В `packages/core/src/room/room.service.int-spec.ts`:
- добавить импорты: `import { EventLogService } from '../realtime/event-log.service';` и `import { readRoomLog } from '../testing/read-room-log';`
- во всех трёх describe заменить `service = new RoomService(db.prisma);` на `service = new RoomService(db.prisma, new EventLogService());`

(На этом шаге файл не компилируется — конструктор ещё старый; это ожидаемо, шаг 4 это исправит. Если хочется зелёной компиляции до RED-прогона, допустимо сначала выполнить шаг 4, затем RED-прогон новых тестов — но тесты нового describe обязаны увидеть RED до реализации emit-вызова: временно закомментировать строку `await this.eventLog.commitCoreEvent(...)` в шаге 4, прогнать RED, раскомментировать.)

- [ ] **Step 2: Добавить describe с тестами эмита (в конец `room.service.int-spec.ts`)**

```ts
describe('RoomService lifecycle log emit (REQ-RT-010)', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    service = new RoomService(db.prisma, new EventLogService());
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  it('complete() emits exactly one public core.room.completed event (seq=1)', async () => {
    const room = await service.create(ORG);
    await service.activate(room.id);
    await service.complete(room.id);

    // Полный путь DRAFT→ACTIVE→COMPLETED: ровно ОДНА строка — activation осознанно
    // не эмитит (шов: payload room.activated = пин REQ-RT-004, appSettings-срез).
    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      seq: 1,
      type: 'core.room.completed',
      visibility: 'public',
      actorId: null,
      payload: {},
      schemaVersion: 1,
    });
  });

  it('cancel() from DRAFT and from ACTIVE emits core.room.cancelled (seq=1 each)', async () => {
    const a = await service.create(ORG);
    await service.cancel(a.id);
    const b = await service.create(ORG);
    await service.activate(b.id);
    await service.cancel(b.id);

    expect((await readRoomLog(db.prisma, a.id)).map((e) => e.type)).toEqual(['core.room.cancelled']);
    expect((await readRoomLog(db.prisma, b.id)).map((e) => [e.seq, e.type])).toEqual([
      [1, 'core.room.cancelled'],
    ]);
  });

  it('emits nothing on illegal transition, terminal transition, create or softDelete', async () => {
    const room = await service.create(ORG);
    await expect(service.complete(room.id)).rejects.toBeInstanceOf(RoomTransitionError);
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);

    await service.activate(room.id);
    await service.complete(room.id);
    await expect(service.cancel(room.id)).rejects.toBeInstanceOf(RoomTransitionError);
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(1); // только completed

    const plain = await service.create(ORG);
    await service.softDelete(plain.id);
    expect(await readRoomLog(db.prisma, plain.id)).toHaveLength(0);
  });

  it('two competing cancels emit exactly one event, from the winner (atomicity)', async () => {
    const room = await service.create(ORG);

    await Promise.allSettled([service.cancel(room.id), service.cancel(room.id)]);

    // Проигравший откатился целиком: ни статуса, ни события (REQ-DEV-008).
    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ seq: 1, type: 'core.room.cancelled', visibility: 'public' });
    expect(
      (await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } })).status,
    ).toBe('CANCELLED');
  });
});
```

- [ ] **Step 3: Прогнать новые тесты — RED**

Сначала выполнить шаг 4 БЕЗ emit-строки (её закомментировать), чтобы файл компилировался.
Run: `pnpm --filter @mymozhem/core test:int -- room.service.int-spec`
Expected: старые тесты PASS; новый describe FAIL — `expected [].toHaveLength(1)` (эмита нет). Затем раскомментировать emit-строку.

- [ ] **Step 4: Переписать `transition` на транзакцию + эмит**

В `packages/core/src/room/room.service.ts`:

Добавить импорты:

```ts
import type { CoreEventName } from '@mymozhem/sdk';
import { EventLogService } from '../realtime/event-log.service';
```

Добавить таблицу маппинга после блока `RoomStatusParity`:

```ts
// Частичная таблица по дизайну (§4): 'room.activated' здесь НЕ эмитится — его payload
// это пин (appId, manifestVersion) REQ-RT-004, который появится только в срезе
// appSettings write path; эмит активации встаёт сюда вместе с ним (design §0 п.1, §10).
const LIFECYCLE_EVENTS: Partial<Record<RoomStatus, CoreEventName>> = {
  COMPLETED: 'room.completed',
  CANCELLED: 'room.cancelled',
};
```

Заменить конструктор:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLog: EventLogService,
  ) {}
```

Заменить тело `transition` (транзакция: SELECT → assert → guarded UPDATE → emit → re-read; бросок внутри = rollback):

```ts
  async transition(roomId: string, to: RoomStatus): Promise<Room> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.room.findUnique({ where: { id: roomId } });
      if (!current || current.deletedAt !== null) {
        throw new RoomConflictError(`Room ${roomId} not found or deleted`);
      }
      // State-machine legality first — precise ROOM_TRANSITION_INVALID for an existing room.
      assertTransition(current.status as RoomStatus, to);
      // Atomic guarded update: correctness of the race rests on this WHERE, not on the
      // read above (REQ-RT-005; same DB-invariant philosophy as REQ-RWD-010).
      const res = await tx.room.updateMany({
        where: { id: roomId, status: current.status, deletedAt: null },
        data: { status: to },
      });
      if (res.count === 0) {
        // → rollback: ни перехода, ни события у проигравшего (REQ-DEV-008).
        throw new RoomConflictError(`Room ${roomId} changed concurrently`);
      }
      const eventName = LIFECYCLE_EVENTS[to];
      if (eventName) {
        await this.eventLog.commitCoreEvent(tx, roomId, eventName, {});
      }
      return tx.room.findUniqueOrThrow({ where: { id: roomId } });
    });
  }
```

- [ ] **Step 5: Обновить `room.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RoomService } from './room.service';

@Module({
  imports: [PrismaModule, RealtimeModule],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}
```

- [ ] **Step 6: Прогнать тесты room — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- room.service.int-spec`
Expected: PASS всех describe (старые 14 + новые 4 = 18 тестов в файле; поведение сервиса для вызывающих не изменилось, добавлен только эмит).

- [ ] **Step 7: Прогнать всю интеграционную лану + unit + typecheck + lint**

Run: `pnpm --filter @mymozhem/core test:int && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core lint`
Expected: всё зелёное (int: 25 + 4 новых emit-теста + 4 primitive = 33; unit: 55 без изменений).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/room packages/core/src/realtime
git commit -m "feat(core): emit room.completed/room.cancelled to log in transition transaction (REQ-RT-010, REQ-DEV-008)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Экспорты, регистрация в сервере, полные гейты, boot-проверка

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `apps/server/src/app.module.ts`

**Interfaces:**
- Consumes: `RealtimeModule`, `EventLogService` (Task 2–3).
- Produces: публичный экспорт `@mymozhem/core`: `RealtimeModule`, `EventLogService`; `AppModule` импортирует `RealtimeModule`.

- [ ] **Step 1: Добавить экспорты в `packages/core/src/index.ts`**

Добавить в конец файла:

```ts
export * from './realtime/event-log.service';
export * from './realtime/realtime.module';
```

- [ ] **Step 2: Зарегистрировать модуль в `apps/server/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import {
  AppRegistryModule,
  HealthModule,
  PrismaModule,
  RealtimeModule,
  RoomModule,
} from '@mymozhem/core';

@Module({
  imports: [PrismaModule, HealthModule, AppRegistryModule, RoomModule, RealtimeModule],
})
export class AppModule {}
```

- [ ] **Step 3: Прогнать boundary-check и guardrails**

Run: `pnpm boundary-check && pnpm guardrails`
Expected: `0 violations` (правило `socketio-only-in-realtime` уже предусматривает `packages/core/src/realtime`; новых правил не требуется — зависимость `room → realtime` внутри core не ограничена, циклов нет). Guardrails: все проверки зелёные.

- [ ] **Step 4: Прогнать полный набор гейтов монорепо**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: всё зелёное во всех пакетах (SDK 162/162 без изменений; core unit 55/55; сборка server с новым импортом проходит).

- [ ] **Step 5: Прогнать интеграционную лану монорепо**

Run: `pnpm test:int`
Expected: всё зелёное (core int: 33 теста). Требуется запущенный Docker Desktop.

- [ ] **Step 6: Boot-проверка артефакта (критерий §9 спеки)**

```bash
docker compose up --build -d
until curl -sf http://localhost:3000/health/ready > /dev/null; do sleep 2; done
docker compose down -v
```

Expected: `/health/ready` отвечает 200 (сервер применил все миграции, включая `realtime_log_event`, на свежей БД). Предусловия: Docker Desktop запущен, порт 3000 свободен. Если boot падает на миграции — это сигнал о проблеме миграции/entrypoint, исправить до коммита, не пропускать.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts apps/server/src/app.module.ts
git commit -m "feat(core): export and register RealtimeModule in server (REQ-RT-010)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review прогон (выполнен при написании)

- **Покрытие спеки:** §2 (модель данных) → Task 1; §3 (примитив, модуль) → Task 2; §4 (transition) → Task 3; §6 (обвязка, экспорты) → Task 4; §7 (тесты: эмит, конкуренция, миграция) → Tasks 1–3; §9 (критерии выхода: гейты, migrate deploy, регистрация, boot) → Task 4. Пробелов нет.
- **Консистентность типов:** `commitCoreEvent(tx, roomId, name, payload?, actorId?)` одинаково в Task 2 (produces) и Task 3 (consumes); `readRoomLog` — один хелпер, два потребителя; конструктор `RoomService(prisma, eventLog)` синхронно в Task 3 produces и всех call-sites.
- **TDD-честность:** RED-прогоны явные (Task 1 step 2; Task 2 step 2; Task 3 step 3 с оговоркой про временное комментирование emit-строки).
