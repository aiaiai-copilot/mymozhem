# Identity Minimal Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `organizerId`-as-plain-UUID stub with a real identity seam: identity table (REQ-ID-001), declarative FK, and atomic guarded INSERT enforcing "organizer must be REGISTERED" (REQ-ID-005).

**Architecture:** New PostgreSQL schema `identity` (ADR-006: schema per module) with `Identity` model and a hand-written partial unique index in the migration SQL (REQ-DEV-006). `RoomService.create` becomes a single atomic `INSERT … SELECT … WHERE EXISTS` — no check-before-write, same philosophy as the guarded UPDATEs of Room lifecycle. SDK gains two contract vocabularies (`identityKindSchema`, `memberRoleSchema`) with fixtures and contract tests, without consumers yet.

**Tech Stack:** NestJS 11 · Prisma 7 (multiSchema, adapter-pg) · PostgreSQL 17 · zod 4 · jest + ts-jest · Testcontainers (`packages/core/src/testing/postgres.testcontainer.ts`).

**Spec:** `docs/sessions/2026-07-22-identity-minimal-seam-design.md` (approved 2026-07-22).

## Global Constraints

- **REQ-DEV-006:** partial unique index — hand-written SQL in the migration + автотест наличия через `pg_indexes`. Prisma preview `partialIndexes` forbidden.
- **Migration freeze:** a migration may be edited in place only before it is applied to any persistent DB and before the branch is published (precedent: `20260718061612_room_lifecycle`). After merge — new migrations only.
- **Testcontainers only:** DB tests go through `startTestDb()` (ephemeral postgres:17). Never a shared/dev/prod DB. `maxWorkers: 1` is load-bearing (the harness mutates global `process.env.DATABASE_URL`).
- **Migration authoring:** `prisma migrate dev` needs a diff target — use the throwaway container pattern (`docker run --rm -d --name mm-migrate … -p 5432:5432 postgres:17`); docker-compose Postgres has no host port by design.
- **Core-internal typed errors** with stable `code`; not part of SDK; no `err.message` across any future HTTP/socket boundary (REQ-SEC-006 forward commitment).
- **No new dependencies.** One lockfile (REQ-DEV-002).
- **Commits** reference REQ-IDs in the message (house style: `feat(core): … (REQ-ID-005)`).
- Prisma client regeneration is required after every schema change before typecheck/tests: `pnpm exec prisma generate`.

---

### Task 1: SDK contract vocabulary — identity kind + member role

**Files:**
- Create: `packages/sdk/src/identity/identity-kind.ts`
- Create: `packages/sdk/src/identity/identity-kind.fixtures.ts`
- Create: `packages/sdk/src/identity/identity-kind.contract.spec.ts`
- Create: `packages/sdk/src/membership/member-role.ts`
- Create: `packages/sdk/src/membership/member-role.fixtures.ts`
- Create: `packages/sdk/src/membership/member-role.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `IDENTITY_KINDS`, `identityKindSchema`, `type IdentityKind`; `MEMBER_ROLES`, `memberRoleSchema`, `type MemberRole` — all re-exported from `@mymozhem/sdk`. No consumer inside this plan by design (contract vocabulary, design §4); later membership/JWT/draw-eligibility slices rely on these exact names.

- [ ] **Step 1: Write the failing contract test for identity kind**

`packages/sdk/src/identity/identity-kind.contract.spec.ts`:

```ts
import { IDENTITY_KINDS, identityKindSchema } from './identity-kind';
import { validKinds, invalidKinds } from './identity-kind.fixtures';

describe('identityKind contract (REQ-ID-001)', () => {
  it('declares exactly the two kinds of REQ-ID-001', () => {
    expect([...IDENTITY_KINDS]).toEqual(['REGISTERED', 'GUEST']);
  });

  it.each(validKinds)('accepts %s', (kind) => {
    expect(identityKindSchema.safeParse(kind).success).toBe(true);
  });

  it.each(invalidKinds.map((v) => [String(v), v] as const))('rejects %s', (_name, v) => {
    expect(identityKindSchema.safeParse(v).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk test -- identity-kind`
Expected: FAIL — `Cannot find module './identity-kind'`.

- [ ] **Step 3: Implement identity-kind + fixtures**

`packages/sdk/src/identity/identity-kind.ts`:

```ts
import { z } from 'zod';

// REQ-ID-001: single identity table, kind REGISTERED | GUEST. Contract vocabulary,
// fixed here so membership, JWT claims and draw_eligibility don't fork literals
// before their slices land.
export const IDENTITY_KINDS = ['REGISTERED', 'GUEST'] as const;
export const identityKindSchema = z.enum(IDENTITY_KINDS);
export type IdentityKind = z.infer<typeof identityKindSchema>;
```

`packages/sdk/src/identity/identity-kind.fixtures.ts`:

```ts
import type { IdentityKind } from './identity-kind';

export const validKinds: IdentityKind[] = ['REGISTERED', 'GUEST'];

// Unknown roles, wrong case, empty, non-strings — all rejected.
export const invalidKinds: unknown[] = ['ADMIN', 'guest', 'registered', '', null, 42];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk test -- identity-kind`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing contract test for member role**

`packages/sdk/src/membership/member-role.contract.spec.ts`:

```ts
import { MEMBER_ROLES, memberRoleSchema } from './member-role';
import { validRoles, invalidRoles } from './member-role.fixtures';

describe('memberRole contract (REQ-ID-011)', () => {
  it('declares exactly the four roles of REQ-ID-011', () => {
    expect([...MEMBER_ROLES]).toEqual(['ORGANIZER', 'MODERATOR', 'PARTICIPANT', 'SPECTATOR']);
  });

  it.each(validRoles)('accepts %s', (role) => {
    expect(memberRoleSchema.safeParse(role).success).toBe(true);
  });

  it.each(invalidRoles.map((v) => [String(v), v] as const))('rejects %s', (_name, v) => {
    expect(memberRoleSchema.safeParse(v).success).toBe(false);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk test -- member-role`
Expected: FAIL — `Cannot find module './member-role'`.

- [ ] **Step 7: Implement member-role + fixtures**

`packages/sdk/src/membership/member-role.ts`:

```ts
import { z } from 'zod';

// REQ-ID-011: membership role model. MODERATOR holds no privileges beyond
// PARTICIPANT until phase 4 (amendment v1.3) but stays in the enumeration;
// the access matrix lands with the membership entity.
export const MEMBER_ROLES = ['ORGANIZER', 'MODERATOR', 'PARTICIPANT', 'SPECTATOR'] as const;
export const memberRoleSchema = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof memberRoleSchema>;
```

`packages/sdk/src/membership/member-role.fixtures.ts`:

```ts
import type { MemberRole } from './member-role';

export const validRoles: MemberRole[] = ['ORGANIZER', 'MODERATOR', 'PARTICIPANT', 'SPECTATOR'];

// Unknown roles, wrong case, empty, non-strings — all rejected.
export const invalidRoles: unknown[] = ['ADMIN', 'organizer', 'owner', '', null, 42];
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/sdk test -- member-role`
Expected: PASS (3 tests).

- [ ] **Step 9: Re-export from the SDK entrypoint and typecheck**

Append to `packages/sdk/src/index.ts`:

```ts
export * from './identity/identity-kind';
export * from './identity/identity-kind.fixtures';
export * from './membership/member-role';
export * from './membership/member-role.fixtures';
```

Run: `pnpm --filter @mymozhem/sdk run typecheck && pnpm --filter @mymozhem/sdk test`
Expected: typecheck PASS; full SDK suite PASS (old + new).

- [ ] **Step 10: Commit**

```bash
git add packages/sdk/src/identity packages/sdk/src/membership packages/sdk/src/index.ts
git commit -m "feat(sdk): identityKind + memberRole contract vocabulary (REQ-ID-001, REQ-ID-011)"
```

---

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

### Task 4: Guarded INSERT in RoomService.create + ROOM_ORGANIZER_NOT_REGISTERED

**Files:**
- Modify: `packages/core/src/room/room.errors.ts`
- Modify: `packages/core/src/room/room.service.ts`
- Modify: `packages/core/src/room/room.service.int-spec.ts`

**Interfaces:**
- Consumes: `seedIdentity` from Task 3.
- Produces: `RoomOrganizerNotRegisteredError` (code `ROOM_ORGANIZER_NOT_REGISTERED` in `ROOM_ERROR_CODES`); `RoomService.create(organizerId: string): Promise<Room>` now rejects non-REGISTERED organizers. No external consumer of the error yet (core-internal, REQ-SEC-006 seam documented).

- [ ] **Step 1: Add the error code and class**

In `packages/core/src/room/room.errors.ts`, extend `ROOM_ERROR_CODES` and add the class:

```ts
export const ROOM_ERROR_CODES = {
  ROOM_TRANSITION_INVALID: 'ROOM_TRANSITION_INVALID',
  ROOM_CONFLICT: 'ROOM_CONFLICT',
  ROOM_ORGANIZER_NOT_REGISTERED: 'ROOM_ORGANIZER_NOT_REGISTERED',
} as const;
```

Append after `RoomConflictError`:

```ts
// Organizer identity missing, GUEST, or anonymized — collapsed into one code on
// purpose (design §3): to the caller it is a single refusal, and the predicate is
// identity's invariant, not a place for reconnaissance.
export class RoomOrganizerNotRegisteredError extends RoomError {
  constructor(message: string) {
    super(ROOM_ERROR_CODES.ROOM_ORGANIZER_NOT_REGISTERED, message);
  }
}
```

- [ ] **Step 2: Write the failing guard tests**

In `packages/core/src/room/room.service.int-spec.ts`, update the import:

```ts
import { RoomError, RoomTransitionError, RoomConflictError, RoomOrganizerNotRegisteredError } from './room.errors';
```

Add these tests inside the `RoomService lifecycle` describe, right after the `'create() yields a DRAFT room'` test:

```ts
  it('rejects a GUEST organizer with ROOM_ORGANIZER_NOT_REGISTERED (REQ-ID-005)', async () => {
    const guest = await seedIdentity(db.prisma, { kind: 'GUEST' });
    const err = await service.create(guest.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoomOrganizerNotRegisteredError);
    expect((err as RoomOrganizerNotRegisteredError).code).toBe('ROOM_ORGANIZER_NOT_REGISTERED');
  });

  it('rejects a nonexistent organizer with the same collapsed code', async () => {
    await expect(
      service.create('00000000-0000-0000-0000-0000000000aa'),
    ).rejects.toBeInstanceOf(RoomOrganizerNotRegisteredError);
  });

  it('rejects an anonymized (deletedAt) REGISTERED organizer', async () => {
    const ghost = await seedIdentity(db.prisma, { kind: 'REGISTERED', deletedAt: new Date() });
    await expect(service.create(ghost.id)).rejects.toBeInstanceOf(RoomOrganizerNotRegisteredError);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @mymozhem/core run test:int -- room.service`
Expected: FAIL — `create` still inserts blindly, so the GUEST/nonexistent/anonymized organizers produce rooms instead of errors.

- [ ] **Step 4: Rewrite create() as an atomic guarded INSERT**

In `packages/core/src/room/room.service.ts`, update the import:

```ts
import { RoomConflictError, RoomOrganizerNotRegisteredError } from './room.errors';
```

Replace the whole `create` method:

```ts
  async create(organizerId: string): Promise<Room> {
    // REQ-ID-005: organizer must be a live REGISTERED identity. One atomic guarded
    // INSERT — the WHERE EXISTS predicate is the single source of truth, no
    // check-before-write (same philosophy as the guarded UPDATEs below). Race-safe
    // structurally: in phase 1 kind is immutable, later flips go GUEST→REGISTERED
    // only (REQ-ID-004), and no flow sets deletedAt on REGISTERED (design §3).
    // The same predicate lives in the "Identity_registered_email_key" index
    // condition (design §7) — change both or neither.
    // `updatedAt` is explicit: Prisma's @updatedAt is client-side, no DB default.
    const rows = await this.prisma.$queryRaw<Room[]>`
      INSERT INTO room."Room" ("id", "organizerId", "status", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), ${organizerId}::uuid, 'DRAFT', now(), now()
      WHERE EXISTS (
        SELECT 1 FROM identity."Identity"
        WHERE "id" = ${organizerId}::uuid
          AND "kind" = 'REGISTERED'
          AND "deletedAt" IS NULL
      )
      RETURNING *
    `;
    if (rows.length === 0) {
      throw new RoomOrganizerNotRegisteredError(
        `Organizer ${organizerId} is not a live REGISTERED identity`,
      );
    }
    return rows[0];
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @mymozhem/core run test:int -- room.service`
Expected: PASS — all lifecycle, atomicity, CHECK, FK, and guard tests.

- [ ] **Step 6: Run the full gate set on the package**

Run: `pnpm --filter @mymozhem/core run typecheck && pnpm --filter @mymozhem/core run test && pnpm --filter @mymozhem/core run test:int && pnpm --filter @mymozhem/core run lint`
Expected: all PASS (unit 5/5, int including new suites, lint clean).

- [ ] **Step 7: Run repo-level gates**

Run: `pnpm run boundary-check && pnpm run guardrails && pnpm --filter @mymozhem/sdk test`
Expected: 0 boundary violations; guardrails alive; SDK suite PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/room
git commit -m "feat(core): enforce REGISTERED organizer via atomic guarded INSERT (REQ-ID-005)"
```

---

## Self-Review Notes (completed by plan author)

- **Spec coverage:** §2 model+migration → Tasks 2–3; §3 guarded INSERT + error → Task 4; §4 SDK vocabulary → Task 1; §5 tests → Tasks 2 (index/FK-adjacent), 3 (FK), 4 (guard). §6 seams — no task builds them, by design. §7 dual-location predicate — comments in Task 2 SQL and Task 4 code.
- **Placeholder scan:** none — every code step carries full code.
- **Type consistency:** `seedIdentity` signature identical in Tasks 3–4; `RoomOrganizerNotRegisteredError` name identical in errors file, service, and tests; `ROOM_ERROR_CODES` extension is additive (existing two codes untouched).
- **Ordering constraint honored:** existing room int-specs break at Task 3 (FK) and are repaired inside Task 3 — every task ends green.
