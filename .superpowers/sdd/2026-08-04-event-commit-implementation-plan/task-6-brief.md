### Task 6: Rate-limit в цепочке — int-тесты

**Files:**
- Test: `packages/core/src/realtime/event-commit.int-spec.ts` (добавить describe)

**Interfaces:**
- Consumes: `commitAppEvent` (Task 5), `EventEmitLimiter` с малым лимитом в конструкции сервиса.

- [ ] **Step 1: Write the failing tests**

В `event-commit.int-spec.ts` добавить второй describe (внешний `afterEach` truncate действует на оба):

```ts
describe('EventLogService.commitAppEvent — rate limit (REQ-RT-014)', () => {
  let db: TestDb;
  let rooms: RoomService;
  let limitedLog: EventLogService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    await seedIdentity(db.prisma, { id: P1, kind: 'GUEST' });
    await seedIdentity(db.prisma, { id: P2, kind: 'GUEST' });
    const registry = new AppRegistryService([TEST_APP]);
    limitedLog = new EventLogService(registry, new EventEmitLimiter(3), TEST_CONFIG);
    rooms = new RoomService(
      db.prisma,
      limitedLog,
      registry,
      new MembershipService(
        db.prisma,
        new IdentityService(db.prisma),
        new JoinRateLimiter(1000),
        TEST_CONFIG,
      ),
      TEST_CONFIG,
    );
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  async function activeRoomWithP1P2() {
    const room = await rooms.create(ORG);
    await rooms.configure(room.id, { appId: 'test-app', manifestVersion: 1, settings: { label: 'x' } });
    await rooms.activate(room.id);
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' } });
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P2, role: 'PARTICIPANT' } });
    return room;
  }

  it('4th attempt in the window is rejected; other actor and null actor unaffected', async () => {
    const room = await activeRoomWithP1P2();
    const emit = (actor: string | null) =>
      db.prisma.$transaction((tx) =>
        limitedLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', actor),
      );

    await emit(P1);
    await emit(P1);
    await emit(P1);
    const err = await emit(P1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventEmitRateLimitedError);

    await emit(P2);   // другой actor — свой бюджет
    await emit(null); // серверная эмиссия — вне per-actor лимита

    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(1 /* activated */ + 3 + 2);
  });

  it('failed attempts burn the budget too (attempts counted, not just successes)', async () => {
    const room = await activeRoomWithP1P2();
    // 3 попытки с невалидным payload (отказ по схеме — после шага лимитера)
    for (let i = 0; i < 3; i++) {
      const e = await db.prisma
        .$transaction((tx) =>
          limitedLog.commitAppEvent(tx, room.id, 'note.posted', { blob: 1 }, 'public', P1),
        )
        .catch((e: unknown) => e);
      expect(e).toBeInstanceOf(EventPayloadInvalidError);
    }
    const err = await db.prisma
      .$transaction((tx) =>
        limitedLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventEmitRateLimitedError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mymozhem/core test:int -t "rate limit"`
Expected: эти тесты ПРОЙДУТ сразу (цепочка Task 5 уже содержит шаг лимитера) — это осознанно: поведение реализовано в Task 5, здесь — характеризующие тесты на граничные семантики (per-actor изоляция, null-actor, подсчёт попыток). Если какой-то падает — чинить `commitAppEvent` до зелёного. Проверить, что фильтр матчит оба новых теста (в выводе jest видно имена).

- [ ] **Step 3: Run full suites**

Run: `pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core test:int` → зелёные.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/realtime/event-commit.int-spec.ts
git commit -m "test(core): rate-limit семантика commitAppEvent — per-actor изоляция, null-actor, подсчёт попыток (REQ-RT-014)"
```

---

