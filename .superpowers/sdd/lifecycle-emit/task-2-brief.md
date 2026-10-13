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

