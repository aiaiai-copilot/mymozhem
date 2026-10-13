### Task 2: Identity Prisma model + migration with partial unique index

**Files:**
- Modify: `packages/core/prisma/schema.prisma`
- Create: `packages/core/prisma/migrations/<timestamp>_identity_seam/migration.sql` (generated, then hand-edited)
- Create: `packages/core/src/identity/identity-schema.int-spec.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (Prisma enum is DB-side; SDK enum is contract-side — no import).
- Produces: `prisma.identity` client model with fields `id: string`, `kind: $Enums.IdentityKind ('REGISTERED' | 'GUEST')`, `email: string | null`, `deletedAt: Date | null`, `createdAt: Date`, `updatedAt: Date`; index `"Identity_registered_email_key"` present in every migrated DB. Task 3 relies on `prisma.identity.create`.

- [ ] **Step 1: Write the failing integration test for the index and uniqueness rules**

`packages/core/src/identity/identity-schema.int-spec.ts`:

```ts
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';

// REQ-ID-001 + REQ-DEV-006: the registered-email partial unique index exists and
// behaves exactly as specified — unique among live REGISTERED rows, case-insensitive,
// ignoring GUEST rows and anonymized (deletedAt) rows.
describe('Identity registered-email partial unique index', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE identity."Identity" CASCADE');
  });

  it('exists in the migrated database (REQ-DEV-006 автотест наличия)', async () => {
    const rows = await db.prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'identity' AND indexname = 'Identity_registered_email_key'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/lower/i);
    expect(rows[0].indexdef).toContain('REGISTERED');
    expect(rows[0].indexdef).toMatch(/deletedAt" IS NULL/i);
  });

  it('rejects a second live REGISTERED row with the same email', async () => {
    await db.prisma.identity.create({ data: { kind: 'REGISTERED', email: 'a@b.c' } });
    await expect(
      db.prisma.identity.create({ data: { kind: 'REGISTERED', email: 'a@b.c' } }),
    ).rejects.toThrow(/[Uu]nique constraint|duplicate key/);
  });

  it('is case-insensitive (lower() in the index)', async () => {
    await db.prisma.identity.create({ data: { kind: 'REGISTERED', email: 'a@b.c' } });
    await expect(
      db.prisma.identity.create({ data: { kind: 'REGISTERED', email: 'A@B.C' } }),
    ).rejects.toThrow(/[Uu]nique constraint|duplicate key/);
  });

  it('allows the same email for two GUEST rows', async () => {
    await db.prisma.identity.create({ data: { kind: 'GUEST', email: 'a@b.c' } });
    await db.prisma.identity.create({ data: { kind: 'GUEST', email: 'a@b.c' } });
    expect(await db.prisma.identity.count()).toBe(2);
  });

  it('allows re-registering an email whose previous REGISTERED row is anonymized', async () => {
    await db.prisma.identity.create({
      data: { kind: 'REGISTERED', email: 'a@b.c', deletedAt: new Date() },
    });
    await db.prisma.identity.create({ data: { kind: 'REGISTERED', email: 'a@b.c' } });
    expect(await db.prisma.identity.count()).toBe(2);
  });

  it('allows many rows with NULL email', async () => {
    await db.prisma.identity.create({ data: { kind: 'REGISTERED' } });
    await db.prisma.identity.create({ data: { kind: 'REGISTERED' } });
    expect(await db.prisma.identity.count()).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core run test:int -- identity-schema`
Expected: FAIL — compile error (`Property 'identity' does not exist on PrismaService`) or `relation "identity"."Identity" does not exist`. Docker Desktop must be running.

- [ ] **Step 3: Add the Identity model to the Prisma schema**

In `packages/core/prisma/schema.prisma`, change the datasource block:

```prisma
datasource db {
  provider = "postgresql"
  schemas  = ["identity", "room"]
}
```

Append at the end of the file:

```prisma
enum IdentityKind {
  REGISTERED
  GUEST

  @@schema("identity")
}

// Identity — core CRUD entity (ADR-004: single table, kind REGISTERED | GUEST).
// deletedAt marks anonymization (REQ-ID-014: PII zeroed, id kept — never physical
// delete while FKs reference it). email is nullable; uniqueness among live
// REGISTERED rows is a hand-written partial index in the migration (REQ-DEV-006),
// NOT a Prisma preview feature.
model Identity {
  id        String       @id @default(uuid()) @db.Uuid
  kind      IdentityKind
  email     String?
  deletedAt DateTime?
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  @@schema("identity")
}
```

- [ ] **Step 4: Verify the schema is valid**

Run: `pnpm exec prisma validate`
Expected: `The schema at packages/core/prisma/schema.prisma is valid 🚀`.

- [ ] **Step 5: Start an ephemeral local Postgres for migration authoring**

```bash
docker run --rm -d --name mm-migrate \
  -e POSTGRES_USER=mm -e POSTGRES_PASSWORD=mm -e POSTGRES_DB=mm \
  -p 5432:5432 postgres:17
until docker exec mm-migrate pg_isready -U mm >/dev/null 2>&1; do sleep 1; done
```

- [ ] **Step 6: Generate the migration WITHOUT applying it**

```bash
DATABASE_URL="postgresql://mm:mm@localhost:5432/mm" \
  pnpm exec prisma migrate dev --name identity_seam --create-only
```

Expected: creates `packages/core/prisma/migrations/<timestamp>_identity_seam/migration.sql` containing `CREATE SCHEMA IF NOT EXISTS "identity"`, `CREATE TYPE "identity"."IdentityKind"`, `CREATE TABLE "identity"."Identity"`.

- [ ] **Step 7: Hand-add the partial unique index to the migration SQL**

Append to `packages/core/prisma/migrations/<timestamp>_identity_seam/migration.sql`:

```sql
-- REQ-ID-001 + REQ-DEV-006: registered-email uniqueness is a partial unique index,
-- hand-written (Prisma preview partialIndexes forbidden). lower() because email is
-- case-insensitive; deletedAt IS NULL frees the email after anonymization
-- (REQ-ID-014). The predicate "REGISTERED and not anonymized" also lives in the
-- guarded INSERT of RoomService.create (design §7) — change both or neither.
CREATE UNIQUE INDEX "Identity_registered_email_key"
  ON "identity"."Identity" (lower("email"))
  WHERE "kind" = 'REGISTERED' AND "deletedAt" IS NULL;
```

- [ ] **Step 8: Apply the migration and regenerate the client**

```bash
DATABASE_URL="postgresql://mm:mm@localhost:5432/mm" \
  pnpm exec prisma migrate dev
```

Expected: applies `<timestamp>_identity_seam`, runs `prisma generate`. No drift warning.

- [ ] **Step 9: Verify the index landed in the authoring DB**

```bash
docker exec mm-migrate psql -U mm -d mm -c \
  "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'identity';"
```

Expected: one row `Identity_registered_email_key`, indexdef contains `lower`, `REGISTERED`, `IS NULL`.

- [ ] **Step 10: Tear down the authoring container**

```bash
docker stop mm-migrate
```

- [ ] **Step 11: Run the integration test to verify it passes**

Run: `pnpm --filter @mymozhem/core run test:int -- identity-schema`
Expected: PASS (6 tests). Testcontainers applies the edited migration via `migrate deploy`.

- [ ] **Step 12: Verify typecheck and the rest of the lanes stay green**

Run: `pnpm --filter @mymozhem/core run typecheck && pnpm --filter @mymozhem/core run test && pnpm --filter @mymozhem/core run lint`
Expected: all PASS. (Room int-specs still pass: no FK yet.)

- [ ] **Step 13: Commit**

```bash
git add packages/core/prisma packages/core/src/identity
git commit -m "feat(core): Identity model + partial unique index migration (REQ-ID-001, REQ-DEV-006)"
```

---

