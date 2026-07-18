import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { RoomService } from './room.service';
import { RoomError, RoomTransitionError, RoomConflictError } from './room.errors';

const ORG = '00000000-0000-0000-0000-000000000001';

describe('RoomService lifecycle', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    service = new RoomService(db.prisma);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  it('create() yields a DRAFT room', async () => {
    const room = await service.create(ORG);
    expect(room.status).toBe('DRAFT');
    expect(room.deletedAt).toBeNull();
    expect(room.organizerId).toBe(ORG);
  });

  it('persists each legal transition', async () => {
    const a = await service.create(ORG);
    expect((await service.activate(a.id)).status).toBe('ACTIVE');
    expect((await service.complete(a.id)).status).toBe('COMPLETED');

    const b = await service.create(ORG);
    expect((await service.cancel(b.id)).status).toBe('CANCELLED');

    const c = await service.create(ORG);
    await service.activate(c.id);
    expect((await service.cancel(c.id)).status).toBe('CANCELLED');
  });

  it('rejects an illegal transition with ROOM_TRANSITION_INVALID', async () => {
    const room = await service.create(ORG);
    await expect(service.complete(room.id)).rejects.toBeInstanceOf(RoomTransitionError);
    // unchanged
    const reread = await db.prisma.room.findUnique({ where: { id: room.id } });
    expect(reread?.status).toBe('DRAFT');
  });

  it('rejects further transitions from a terminal status', async () => {
    const room = await service.create(ORG);
    await service.cancel(room.id);
    await expect(service.activate(room.id)).rejects.toBeInstanceOf(RoomTransitionError);
  });

  it('rejects transition of a missing room with ROOM_CONFLICT', async () => {
    await expect(
      service.activate('00000000-0000-0000-0000-0000000000ff'),
    ).rejects.toBeInstanceOf(RoomConflictError);
  });

  it('soft-deletes in DRAFT/COMPLETED/CANCELLED, refuses in ACTIVE', async () => {
    const draft = await service.create(ORG);
    expect((await service.softDelete(draft.id)).deletedAt).not.toBeNull();

    const active = await service.create(ORG);
    await service.activate(active.id);
    await expect(service.softDelete(active.id)).rejects.toBeInstanceOf(RoomTransitionError);

    const cancelled = await service.create(ORG);
    await service.cancel(cancelled.id);
    const deleted = await service.softDelete(cancelled.id);
    expect(deleted.deletedAt).not.toBeNull();
    // Orthogonality (REQ-RT-005): soft-delete is not a status — status must survive
    // softDelete unchanged.
    expect(deleted.status).toBe('CANCELLED');
  });

  it('a soft-deleted room is inert (transitions conflict)', async () => {
    const room = await service.create(ORG);
    await service.softDelete(room.id);
    await expect(service.activate(room.id)).rejects.toBeInstanceOf(RoomConflictError);
  });
});

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

  // Deliberately NOT racing activate() vs cancel(): if the two calls happen to
  // serialize instead of interleave, the second one reads ACTIVE, and
  // ACTIVE -> CANCELLED is a *legal* edge — both would succeed and the test would
  // fail with no defect present. That pairing is schedule-dependent and cannot
  // prove atomicity.
  //
  // Racing cancel() vs cancel() on one DRAFT room has exactly one winner under
  // every possible schedule:
  //   - Interleaved: both read DRAFT, both pass assertTransition, both issue the
  //     guarded UPDATE; one affects 1 row, the loser affects 0 rows -> RoomConflictError.
  //   - Serialized: the loser reads CANCELLED, which is terminal, so
  //     assertTransition itself throws -> RoomTransitionError.
  // Either outcome is a legitimate proof that only one CANCELLED transition ever
  // lands; which specific error class the loser gets depends on the (unobservable)
  // schedule. Do not tighten the assertion below to one subclass — that would
  // reintroduce the same flakiness this test is designed to avoid.
  it('two competing cancels on one room: exactly one wins, the other is rejected', async () => {
    const room = await service.create(ORG);

    const results = await Promise.allSettled([service.cancel(room.id), service.cancel(room.id)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(RoomError);

    const finalStatus = (await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
      .status;
    expect(finalStatus).toBe('CANCELLED');
  });
});

describe('Room CHECK constraint: soft-delete is incompatible with ACTIVE', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    service = new RoomService(db.prisma);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  // RoomService can never produce this write: softDelete() guards against ACTIVE, and no
  // transition can reach ACTIVE while deletedAt is already set. Go around the service with
  // raw SQL to prove the invariant is enforced by the database itself (the
  // Room_softdelete_not_active CHECK constraint), not merely by application code
  // (REQ-RWD-010 philosophy: DB invariant, not check-before-write).
  it('rejects an UPDATE that sets deletedAt on an ACTIVE room, at the database level', async () => {
    const room = await service.create(ORG);
    await service.activate(room.id);

    await expect(
      db.prisma.$executeRawUnsafe(`UPDATE room."Room" SET "deletedAt" = now() WHERE id = $1`, room.id),
    ).rejects.toThrow(/Room_softdelete_not_active/);

    // Unaffected: the rejected write must not have partially applied.
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.deletedAt).toBeNull();
    expect(reread.status).toBe('ACTIVE');
  });

  it('rejects an INSERT of a row that is both ACTIVE and soft-deleted, at the database level', async () => {
    await expect(
      db.prisma.$executeRawUnsafe(
        `INSERT INTO room."Room" (id, "organizerId", status, "deletedAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, 'ACTIVE', now(), now())`,
        ORG,
      ),
    ).rejects.toThrow(/Room_softdelete_not_active/);
  });
});
