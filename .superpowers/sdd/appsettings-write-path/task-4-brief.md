### Task 4: Активация — предусловие, перевалидация, эмит room.activated (REQ-RT-004, REQ-RT-010)

**Files:**
- Modify: `packages/core/src/room/room.service.ts` (transition + комментарий LIFECYCLE_EVENTS)
- Test: `packages/core/src/room/room.service.int-spec.ts` (обновление существующих тестов + новый describe)

**Interfaces:**
- Consumes: `RoomService.configure` и `RoomSettingsFrozenError` (Task 3), `RoomNotConfiguredError` (Task 3, room.errors), `validateSettings` (Task 2).
- Produces: активация эмитит `core.room.activated` с payload `{ appId, manifestVersion }` (словарь `CORE_EVENTS` SDK — без изменений); регрессионный якорь лога — две строки.

- [ ] **Step 1: Обновить существующие тесты под новый контракт активации (RED)**

Все места, где тест вызывает `activate`, теперь обязаны сначала сконфигурировать комнату — активация неконфигурированной отклоняется.

а) `describe('RoomService lifecycle')`, тест `'persists each legal transition'` — вставить configure перед каждым activate:

```ts
  it('persists each legal transition', async () => {
    const a = await service.create(ORG);
    await configureQuiz(service, a.id);
    expect((await service.activate(a.id)).status).toBe('ACTIVE');
    expect((await service.complete(a.id)).status).toBe('COMPLETED');

    const b = await service.create(ORG);
    expect((await service.cancel(b.id)).status).toBe('CANCELLED');

    const c = await service.create(ORG);
    await configureQuiz(service, c.id);
    await service.activate(c.id);
    expect((await service.cancel(c.id)).status).toBe('CANCELLED');
  });
```

б) Тот же describe, `'soft-deletes in DRAFT/COMPLETED/CANCELLED, refuses in ACTIVE'` — перед `service.activate(active.id)` вставить `await configureQuiz(service, active.id);`.

в) `describe('Room CHECK constraint…')`, тест `'rejects an UPDATE that sets deletedAt on an ACTIVE room…'` — перед `service.activate(room.id)` вставить `await configureQuiz(service, room.id);`.

г) `describe('RoomService lifecycle log emit (REQ-RT-010)')` — заменить три теста:

```ts
  it('full path DRAFT→ACTIVE→COMPLETED emits room.activated (pin) then room.completed', async () => {
    const room = await service.create(ORG);
    await configureQuiz(service, room.id);
    await service.activate(room.id);
    await service.complete(room.id);

    // REQ-RT-010 3/3: обе строки public; activated несёт пин замороженной тройки
    // (REQ-RT-004). Регрессионный якорь среза lifecycle-эмита обновлён: 1 строка → 2.
    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      seq: 1,
      type: 'core.room.activated',
      visibility: 'public',
      actorId: null,
      payload: { appId: 'quiz', manifestVersion: 1 },
      schemaVersion: 1,
    });
    expect(log[1]).toMatchObject({
      seq: 2,
      type: 'core.room.completed',
      visibility: 'public',
      actorId: null,
      payload: {},
      schemaVersion: 1,
    });
  });

  it('cancel() from DRAFT and from ACTIVE emits core.room.cancelled', async () => {
    const a = await service.create(ORG);
    await service.cancel(a.id);
    const b = await service.create(ORG);
    await configureQuiz(service, b.id);
    await service.activate(b.id);
    await service.cancel(b.id);

    expect((await readRoomLog(db.prisma, a.id)).map((e) => e.type)).toEqual(['core.room.cancelled']);
    expect((await readRoomLog(db.prisma, b.id)).map((e) => [e.seq, e.type])).toEqual([
      [1, 'core.room.activated'],
      [2, 'core.room.cancelled'],
    ]);
  });

  it('emits nothing on illegal transition, terminal transition, create or softDelete', async () => {
    const room = await service.create(ORG);
    await expect(service.complete(room.id)).rejects.toBeInstanceOf(RoomTransitionError);
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);

    await configureQuiz(service, room.id);
    await service.activate(room.id);
    await service.complete(room.id);
    await expect(service.cancel(room.id)).rejects.toBeInstanceOf(RoomTransitionError);
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(2); // activated + completed

    const plain = await service.create(ORG);
    await service.softDelete(plain.id);
    expect(await readRoomLog(db.prisma, plain.id)).toHaveLength(0);
  });
```

- [ ] **Step 2: Написать failing-тесты гейта активации**

Добавить в конец int-spec:

```ts
describe('RoomService activation gate (REQ-RT-004, REQ-CORE-007)', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    service = makeService(db);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  it('rejects activation of an unconfigured room; room stays DRAFT, log stays empty', async () => {
    const room = await service.create(ORG);
    const err = await service.activate(room.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoomNotConfiguredError);
    expect((err as RoomNotConfiguredError).code).toBe('ROOM_NOT_CONFIGURED');
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.status).toBe('DRAFT');
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);
  });

  // Перевалидация при активации — не декорация (design §5): подменяем настройки
  // напрямую в БД минуя сервис (configure такое не запишет) — активация обязана
  // отклонить и откатиться целиком (REQ-DEV-008).
  it('re-validates settings at activation: tampered appSettings roll everything back', async () => {
    const room = await service.create(ORG);
    await configureQuiz(service, room.id);
    await db.prisma.$executeRawUnsafe(
      `UPDATE room."Room" SET "appSettings" = '{}'::jsonb WHERE id = $1`,
      room.id,
    );
    const err = await service.activate(room.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppSettingsInvalidError);
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.status).toBe('DRAFT');
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);
  });

  // Реестр boot-time, строка комнаты durable: активация против версии, которой нет
  // в реестре процесса (редеплой убрал), обязана отказать (design §5).
  it('rejects activation when the pinned manifest is absent from the registry', async () => {
    const room = await service.create(ORG);
    await configureQuiz(service, room.id);
    const emptyRegistryService = new RoomService(
      db.prisma,
      new EventLogService(),
      new AppRegistryService([]),
    );
    const err = await emptyRegistryService.activate(room.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppManifestUnknownError);
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.status).toBe('DRAFT');
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);
  });

  // Гонка configure vs activate (design §5): row-lock guarded UPDATE активации —
  // точка сериализации. Ровно одно из двух: configure успел (активирована новая
  // тройка) или получил ROOM_SETTINGS_FROZEN (активирована прежняя). Пин в событии
  // совпадает с замороженной строкой при любом исходе. НЕ сужать до одного исхода —
  // расписание ненаблюдаемо (прецедент: race-тест cancel/cancel).
  it('configure vs activate race: one winner, pin in the event matches the frozen row', async () => {
    const room = await service.create(ORG);
    await configureQuiz(service, room.id);
    const newSettings = { title: 'Raced quiz', correctAnswers: [3] };

    const [cfg, act] = await Promise.allSettled([
      service.configure(room.id, { appId: 'quiz', manifestVersion: 1, settings: newSettings }),
      service.activate(room.id),
    ]);

    const final = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(final.status).toBe('ACTIVE');
    expect(act.status).toBe('fulfilled');
    if (cfg.status === 'rejected') {
      expect(cfg.reason).toBeInstanceOf(RoomSettingsFrozenError);
      expect(final.appSettings).toEqual(QUIZ_SETTINGS);
    } else {
      expect(final.appSettings).toEqual(newSettings);
    }
    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      seq: 1,
      type: 'core.room.activated',
      payload: { appId: final.appId, manifestVersion: final.manifestVersion },
    });
  });
});
```

Импорт `RoomNotConfiguredError` добавить в импорт из `./room.errors` (Step 1 Task 3 его ещё не импортировал).

- [ ] **Step 3: Прогнать — подтвердить RED**

Run: `pnpm --filter @mymozhem/core test:int -- -t "activation gate"`
Expected: FAIL — 4 новых теста падают (активация пока не проверяет конфигурацию и не эмитит; race-тест: лог пуст). Также красными станут обновлённые в Step 1 тесты log-эмита (ожидают две строки).

- [ ] **Step 4: Реализовать ветку активации в transition**

В `packages/core/src/room/room.service.ts`:

а) обновить комментарий у `LIFECYCLE_EVENTS` и сам импорт ошибок:

```ts
import {
  RoomConflictError,
  RoomNotConfiguredError,
  RoomOrganizerNotRegisteredError,
  RoomSettingsFrozenError,
} from './room.errors';
```

```ts
// Терминальные переходы с пустым payload (REQ-RT-010). 'room.activated' — особая
// ветка в transition: его payload — пин (appId, manifestVersion) из замороженной
// строки (REQ-RT-004, design §5).
const LIFECYCLE_EVENTS: Partial<Record<RoomStatus, CoreEventName>> = {
  COMPLETED: 'room.completed',
  CANCELLED: 'room.cancelled',
};
```

б) заменить метод `transition` целиком:

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
      // Для активации это ещё и точка сериализации с configure: updateMany берёт
      // row-lock — конкурентный configure либо уже закоммичен (и виден в re-read
      // ниже), либо ждёт наш коммит и получает ROOM_SETTINGS_FROZEN (design §5).
      const res = await tx.room.updateMany({
        where: { id: roomId, status: current.status, deletedAt: null },
        data: { status: to },
      });
      if (res.count === 0) {
        // → rollback: ни перехода, ни события у проигравшего (REQ-DEV-008).
        throw new RoomConflictError(`Room ${roomId} changed concurrently`);
      }
      // Re-read ПОСЛЕ row-lock: снимок, который перевалидируется, пинится и эмитится.
      // Чтение пина из `current` (до лока) могло бы отдать в room.activated пин,
      // который конкурентный configure уже перезаписал, — событие ≠ состояние.
      const updated = await tx.room.findUniqueOrThrow({ where: { id: roomId } });
      if (to === 'ACTIVE') {
        // REQ-RT-004: активация требует сконфигурированной комнаты — payload
        // room.activated это пин, неконфигурированной он неоткуда взяться.
        // Отказ откатывает и переход, и событие (REQ-DEV-008).
        if (
          updated.appId === null ||
          updated.manifestVersion === null ||
          updated.appSettings === null
        ) {
          throw new RoomNotConfiguredError(`Room ${roomId} has no app configuration`);
        }
        // REQ-CORE-007: повторная валидация при DRAFT → ACTIVE. Реестр boot-time,
        // строка durable: редеплой мог убрать манифест или изменить схему версии.
        this.appRegistry.validateSettings(
          updated.appId,
          updated.manifestVersion,
          updated.appSettings,
        );
        // Эмит — последним в транзакции: advisory lock комнаты всегда leaf-most,
        // после его захвата room."Room" в этой транзакции не пишем (конвенция
        // порядка блокировок, HANDOFF «Долгоживущие ограничения»).
        await this.eventLog.commitCoreEvent(tx, roomId, 'room.activated', {
          appId: updated.appId,
          manifestVersion: updated.manifestVersion,
        });
      } else {
        const eventName = LIFECYCLE_EVENTS[to];
        if (eventName) {
          await this.eventLog.commitCoreEvent(tx, roomId, eventName, {});
        }
      }
      return updated;
    });
  }
```

- [ ] **Step 5: Прогнать — GREEN, полная интеграционная лана**

Run: `pnpm --filter @mymozhem/core test:int`
Expected: PASS все describe (lifecycle, atomicity, CHECK ×2, organizerId FK, log emit, config triple, configure, activation gate). Никаких skipped.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/room
git commit -m "feat(core): activation freeze + room.activated emit (REQ-RT-004, REQ-RT-010, REQ-CORE-007, REQ-DEV-008)"
```

---

