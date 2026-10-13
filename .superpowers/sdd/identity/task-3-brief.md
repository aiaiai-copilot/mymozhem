### Task 3: FK room.organizerId → identity.id + repair of existing room int-specs

**Files:**
- Modify: `packages/core/prisma/schema.prisma`
- Create: `packages/core/prisma/migrations/<timestamp>_room_organizer_fk/migration.sql` (generated, no hand edits)
- Create: `packages/core/src/testing/seed-identity.ts`
- Modify: `packages/core/src/room/room.service.int-spec.ts`

**Interfaces:**
- Consumes: `prisma.identity.create` from Task 2.
- Produces: `seedIdentity(prisma, data?)` helper (used by Task 4 tests); relation `Room.organizer` / `Identity.rooms`; constraint `"Room_organizerId_fkey"`.

- [ ] **Step 1: Write the failing FK test**

In `packages/core/src/room/room.service.int-spec.ts`, append a new describe block at the end of the file:

```ts
describe('Room organizerId FK', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  // Raw SQL around the service: the database itself must refuse an organizer that
  // does not exist in identity."Identity" (declarative FK, REQ-ID-005).
  it('rejects a room whose organizerId is not an identity, at the database level', async () => {
    await expect(
      db.prisma.$executeRawUnsafe(
        `INSERT INTO room."Room" (id, "organizerId", status, "updatedAt")
         VALUES (gen_random_uuid(), $1, 'DRAFT', now())`,
        '00000000-0000-0000-0000-0000000000ee',
      ),
    ).rejects.toThrow(/Room_organizerId_fkey/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core run test:int -- room.service`
Expected: FAIL — the raw INSERT succeeds (no FK yet), so `rejects` has nothing to catch.

- [ ] **Step 3: Add the relation to the Prisma schema**

In `packages/core/prisma/schema.prisma`, update the `Room` model — replace the stale stub comment and the bare `organizerId` line, and add the back-relation on `Identity`:

```prisma
// Room — core CRUD lifecycle entity (ADR-005: not event-sourced). State machine
// in room-state-machine.ts (REQ-RT-005). organizerId is a declarative FK to
// identity.id; the REGISTERED invariant (REQ-ID-005) is enforced by the guarded
// INSERT in RoomService.create, not by the FK itself.
// appSettings/pin/freeze (REQ-RT-004) deferred to a later plan.
model Room {
  id          String     @id @default(uuid()) @db.Uuid
  organizer   Identity   @relation(fields: [organizerId], references: [id])
  organizerId String     @db.Uuid
  status      RoomStatus @default(DRAFT)
  deletedAt   DateTime?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  @@schema("room")
}
```

Add to the `Identity` model (inside its braces, after `updatedAt`):

```prisma
  rooms     Room[]
```

Note: default referential action (Restrict) is intended — identity rows are never physically deleted, only anonymized (REQ-ID-014).

- [ ] **Step 4: Generate and apply the FK migration**

```bash
docker run --rm -d --name mm-migrate \
  -e POSTGRES_USER=mm -e POSTGRES_PASSWORD=mm -e POSTGRES_DB=mm \
  -p 5432:5432 postgres:17
until docker exec mm-migrate pg_isready -U mm >/dev/null 2>&1; do sleep 1; done

DATABASE_URL="postgresql://mm:mm@localhost:5432/mm" \
  pnpm exec prisma migrate dev --name room_organizer_fk

docker stop mm-migrate
```

Expected: migration containing `ALTER TABLE "room"."Room" ADD CONSTRAINT "Room_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "identity"."Identity"("id")`; client regenerated. No hand edits to this migration.

- [ ] **Step 5: Create the seed helper**

`packages/core/src/testing/seed-identity.ts`:

```ts
import type { $Enums } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

// Test-side seeding of identity rows. No IdentityService exists in core by design
// (design §6: the first real flow — guest join or OAuth — will own it); until then
// tests are the only writers, via the Prisma client directly.
export function seedIdentity(
  prisma: PrismaService,
  data: {
    id?: string;
    kind?: $Enums.IdentityKind;
    email?: string | null;
    deletedAt?: Date | null;
  } = {},
) {
  return prisma.identity.create({
    data: {
      id: data.id,
      kind: data.kind ?? 'REGISTERED',
      email: data.email ?? null,
      deletedAt: data.deletedAt ?? null,
    },
  });
}
```

- [ ] **Step 6: Repair the three existing describes — seed the organizer identity**

In `packages/core/src/room/room.service.int-spec.ts`:

Add the import at the top:

```ts
import { seedIdentity } from '../testing/seed-identity';
```

In **each of the three existing `beforeAll` blocks** (`RoomService lifecycle`, `RoomService transition atomicity`, `Room CHECK constraint`), insert the seed immediately after `db = await startTestDb();`:

```ts
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
```

(Each describe starts its own container, so the fixed email cannot collide across describes.)

- [ ] **Step 7: Run the integration lane to verify everything passes**

Run: `pnpm --filter @mymozhem/core run test:int`
Expected: PASS — all previous room tests (now FK-satisfied), the identity-schema suite, and the new FK test.

- [ ] **Step 8: Verify typecheck + unit + lint**

Run: `pnpm --filter @mymozhem/core run typecheck && pnpm --filter @mymozhem/core run test && pnpm --filter @mymozhem/core run lint`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/prisma packages/core/src/testing/seed-identity.ts packages/core/src/room/room.service.int-spec.ts
git commit -m "feat(core): FK room.organizerId to identity.id + test seeding (REQ-ID-005)"
```

---

