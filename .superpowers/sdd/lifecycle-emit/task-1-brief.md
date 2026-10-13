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

