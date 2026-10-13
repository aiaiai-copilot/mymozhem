## Task 5: Concurrency / atomicity integration test

**Files:**
- Test: `packages/core/src/room/room.service.int-spec.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `RoomService`, `startTestDb`, `RoomConflictError` (as above).

- [ ] **Step 1: Add the failing concurrency test**

Append to `packages/core/src/room/room.service.int-spec.ts` (inside the file, a new top-level `describe`):

```ts
describe('RoomService transition atomicity', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    service = new RoomService(db.prisma);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  it('two competing transitions on one room: exactly one wins, the other conflicts', async () => {
    const room = await service.create(ORG);

    const results = await Promise.allSettled([
      service.activate(room.id), // DRAFT -> ACTIVE
      service.cancel(room.id), // DRAFT -> CANCELLED
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(RoomConflictError);

    const finalStatus = (await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
      .status;
    expect(['ACTIVE', 'CANCELLED']).toContain(finalStatus);
  });
});
```

Note: this test imports nothing new — `TestDb`, `startTestDb`, `RoomService`, `RoomConflictError`, and `ORG` are already imported/defined at the top of the file from Task 4.

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/core run test:int -- room.service`
Expected: PASS — the atomic guarded UPDATE lets exactly one transition win; the loser gets `ROOM_CONFLICT`. (If this ever fails intermittently, it means the transition is not atomic — a real defect, not flakiness.)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/room/room.service.int-spec.ts
git commit -m "test(core): prove transition atomicity under concurrency (REQ-RT-005)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

