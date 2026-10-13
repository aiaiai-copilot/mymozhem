## Task 4: RoomService — create, transitions, soft-delete

**Files:**
- Create: `packages/core/src/room/room.service.ts`
- Test: `packages/core/src/room/room.service.int-spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (`packages/core/src/prisma/prisma.service.ts`); pure module (`assertTransition`, `assertDeletable`, `RoomStatus`); `RoomConflictError` (Task 1); `startTestDb` (Task 3).
- Produces:
  - `class RoomService { create(organizerId: string): Promise<Room>; transition(roomId: string, to: RoomStatus): Promise<Room>; activate/complete/cancel(roomId: string): Promise<Room>; softDelete(roomId: string): Promise<Room> }`
  (`Room` is the Prisma-generated row type.)

- [ ] **Step 1: Write the failing integration test**

Create `packages/core/src/room/room.service.int-spec.ts`:

```ts
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { RoomService } from './room.service';
import { RoomTransitionError, RoomConflictError } from './room.errors';

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
    expect((await service.softDelete(cancelled.id)).deletedAt).not.toBeNull();
  });

  it('a soft-deleted room is inert (transitions conflict)', async () => {
    const room = await service.create(ORG);
    await service.softDelete(room.id);
    await expect(service.activate(room.id)).rejects.toBeInstanceOf(RoomConflictError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core run test:int -- room.service`
Expected: FAIL — cannot find module `./room.service`.

- [ ] **Step 3: Implement RoomService**

Create `packages/core/src/room/room.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Room } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertTransition, assertDeletable, type RoomStatus } from './room-state-machine';
import { RoomConflictError } from './room.errors';

@Injectable()
export class RoomService {
  constructor(private readonly prisma: PrismaService) {}

  create(organizerId: string): Promise<Room> {
    // Organizer is a plain id here; REGISTERED check + FK deferred (REQ-ID-005).
    return this.prisma.room.create({ data: { organizerId } });
  }

  async transition(roomId: string, to: RoomStatus): Promise<Room> {
    const current = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!current || current.deletedAt !== null) {
      throw new RoomConflictError(`Room ${roomId} not found or deleted`);
    }
    // State-machine legality first — precise ROOM_TRANSITION_INVALID for an existing room.
    assertTransition(current.status as RoomStatus, to);
    // Atomic guarded update: correctness of the race rests on this WHERE, not on the
    // read above (REQ-RT-005; same DB-invariant philosophy as REQ-RWD-010).
    const res = await this.prisma.room.updateMany({
      where: { id: roomId, status: current.status, deletedAt: null },
      data: { status: to },
    });
    if (res.count === 0) {
      throw new RoomConflictError(`Room ${roomId} changed concurrently`);
    }
    return this.prisma.room.findUniqueOrThrow({ where: { id: roomId } });
  }

  activate(roomId: string): Promise<Room> {
    return this.transition(roomId, 'ACTIVE');
  }

  complete(roomId: string): Promise<Room> {
    return this.transition(roomId, 'COMPLETED');
  }

  cancel(roomId: string): Promise<Room> {
    return this.transition(roomId, 'CANCELLED');
  }

  async softDelete(roomId: string): Promise<Room> {
    const current = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!current || current.deletedAt !== null) {
      throw new RoomConflictError(`Room ${roomId} not found or already deleted`);
    }
    assertDeletable(current.status as RoomStatus);
    const res = await this.prisma.room.updateMany({
      where: { id: roomId, deletedAt: null, status: { not: 'ACTIVE' } },
      data: { deletedAt: new Date() },
    });
    if (res.count === 0) {
      throw new RoomConflictError(`Room ${roomId} changed concurrently`);
    }
    return this.prisma.room.findUniqueOrThrow({ where: { id: roomId } });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/core run test:int -- room.service`
Expected: PASS — all lifecycle cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/room/room.service.ts packages/core/src/room/room.service.int-spec.ts
git commit -m "feat(core): RoomService lifecycle via atomic guarded update (REQ-RT-005, REQ-CORE-006)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

