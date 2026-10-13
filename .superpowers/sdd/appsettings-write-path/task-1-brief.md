### Task 1: Миграция — колонки конфигурации + CHECK тройки на room."Room"

**Files:**
- Modify: `packages/core/prisma/schema.prisma` (модель Room, строки с комментарием «appSettings/pin/freeze deferred»)
- Create: `packages/core/prisma/migrations/<timestamp>_room_app_config/migration.sql` (генерируется, затем редактируется вручную)
- Test: `packages/core/src/room/room.service.int-spec.ts` (новый describe в конце файла)

**Interfaces:**
- Consumes: существующие `startTestDb`, `seedIdentity`, `RoomService.create`.
- Produces: поля `appId: string | null`, `manifestVersion: number | null`, `appSettings: Prisma.JsonValue` на Prisma-модели `Room`; CHECK-констрейнт `"Room_config_triple"` — на них опираются Tasks 3–4.

- [ ] **Step 1: Написать failing-тесты CHECK-инварианта**

Добавить в конец `packages/core/src/room/room.service.int-spec.ts`:

```ts
describe('Room config triple CHECK constraint (REQ-RT-004)', () => {
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

  it('accepts an all-NULL triple and a fully-set triple', async () => {
    const room = await service.create(ORG); // тройка NULL
    await db.prisma.$executeRawUnsafe(
      `UPDATE room."Room"
       SET "appId" = 'quiz', "manifestVersion" = 1, "appSettings" = '{}'::jsonb
       WHERE id = $1`,
      room.id,
    );
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.appId).toBe('quiz');
    expect(reread.manifestVersion).toBe(1);
  });

  // Инвариант тройки (design §2): либо все NULL, либо все заданы. Сервис такую запись
  // не производит никогда (единственный путь — configure, Task 3), поэтому проверяем
  // сырым SQL, что инвариант держит сама БД (философия REQ-RWD-010).
  it.each([
    { set: `"appId" = 'quiz'`, label: 'appId without the rest' },
    { set: `"appId" = 'quiz', "manifestVersion" = 1`, label: 'pin without appSettings' },
    { set: `"appSettings" = '{}'::jsonb`, label: 'appSettings without the pin' },
  ])('rejects a partial triple at the database level ($label)', async ({ set }) => {
    const room = await service.create(ORG);
    await expect(
      db.prisma.$executeRawUnsafe(`UPDATE room."Room" SET ${set} WHERE id = $1`, room.id),
    ).rejects.toThrow(/Room_config_triple/);
  });
});
```

- [ ] **Step 2: Прогнать тесты — подтвердить RED**

Run: `pnpm --filter @mymozhem/core test:int -- -t "config triple"`
Expected: FAIL — `column "appId" does not exist` (колонок ещё нет).

- [ ] **Step 3: Обновить schema.prisma**

В `packages/core/prisma/schema.prisma` заменить комментарий и модель Room:

```prisma
// Room — core CRUD lifecycle entity (ADR-005: not event-sourced). State machine
// in room-state-machine.ts (REQ-RT-005). organizerId is a declarative FK to
// identity.id; the REGISTERED invariant (REQ-ID-005) is enforced by the guarded
// INSERT in RoomService.create, not by the FK itself.
// Конфигурация приложения (REQ-RT-004): тройка (appId, manifestVersion, appSettings)
// атомарна — либо все NULL, либо все заданы (CHECK "Room_config_triple", рукописная
// часть миграции room_app_config). Единственный путь записи — RoomService.configure;
// заморозка — предикат status = 'DRAFT' в его guarded UPDATE, не флаг.
model Room {
  id              String     @id @default(uuid()) @db.Uuid
  organizer       Identity   @relation(fields: [organizerId], references: [id])
  organizerId     String     @db.Uuid
  status          RoomStatus @default(DRAFT)
  appId           String?
  manifestVersion Int?
  appSettings     Json?
  deletedAt       DateTime?
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
  logEvents       LogEvent[]

  @@schema("room")
}
```

- [ ] **Step 4: Сгенерировать миграцию (--create-only) с authoring-контейнера**

Run (cwd = корень репозитория):

```bash
docker run -d --name mm-migrate -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
until docker exec mm-migrate pg_isready -U postgres | grep -q "accepting connections"; do sleep 1; done
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres pnpm exec prisma migrate dev --name room_app_config --create-only
```

Expected: создана `packages/core/prisma/migrations/<timestamp>_room_app_config/migration.sql` с тремя `ADD COLUMN`. Миграция НЕ применена.

- [ ] **Step 5: Дописать CHECK вручную и применить**

Дописать в конец сгенерированного `migration.sql`:

```sql
-- Рукописная часть (практика REQ-DEV-006): тройка конфигурации атомарна —
-- либо все NULL, либо все NOT NULL (design §2). Единственный сервисный путь записи
-- заменяет тройку целиком; CHECK — страховка от обхода сервиса.
ALTER TABLE room."Room" ADD CONSTRAINT "Room_config_triple"
CHECK (
  ("appId" IS NULL) = ("manifestVersion" IS NULL)
  AND ("appId" IS NULL) = ("appSettings" IS NULL)
);
```

Применить и сгенерировать клиент (cwd = корень):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres pnpm exec prisma migrate dev
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres pnpm exec prisma generate
docker rm -f mm-migrate
```

Expected: миграция применена чисто (`Applying migration ... room_app_config`), клиент сгенерирован. Проверка клиента: `pnpm --filter @mymozhem/core typecheck` после Step 1 увидит `reread.appId` без ошибок.

- [ ] **Step 6: Прогнать тесты — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- -t "config triple"`
Expected: PASS (2 теста: принятие NULL/полной тройки + 3 кейса it.each отказов).

- [ ] **Step 7: Commit**

```bash
git add packages/core/prisma packages/core/src/room/room.service.int-spec.ts
git commit -m "feat(core): room app config columns + triple CHECK migration (REQ-RT-004)"
```

---

