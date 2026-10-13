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

