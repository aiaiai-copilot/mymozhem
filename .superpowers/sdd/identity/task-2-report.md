# Task 2 Report: Identity Prisma model + migration with partial unique index

## What I implemented

- Added the `identity` PostgreSQL schema to the Prisma `multiSchema` datasource (`schemas = ["identity", "room"]`, ADR-006).
- Added `IdentityKind` enum (`REGISTERED | GUEST`) and `Identity` model (`id` UUID PK, `kind`, nullable `email`, `deletedAt`, `createdAt`, `updatedAt`) to `packages/core/prisma/schema.prisma`, verbatim from the brief.
- Generated migration `20260722151900_identity_seam` via `prisma migrate dev --create-only` against a throwaway authoring container, then hand-appended the partial unique index SQL verbatim from the brief (REQ-ID-001 + REQ-DEV-006; no Prisma preview `partialIndexes`).
- Wrote the integration test `packages/core/src/identity/identity-schema.int-spec.ts` verbatim from the brief (6 tests: index presence via `pg_indexes`, duplicate rejection, case-insensitivity, GUEST exemption, anonymized-row exemption, NULL-email allowance).

## What I tested and test results

- **Schema validation:** `prisma validate` → "The schema at packages/core/prisma/schema.prisma is valid".
- **Migration authoring:** `migrate dev --create-only` produced exactly `CREATE SCHEMA IF NOT EXISTS "identity"`, `CREATE TYPE "identity"."IdentityKind"`, `CREATE TABLE "identity"."Identity"`. After appending the index SQL, `migrate dev` applied with **no drift warning**.
- **Step 9 psql evidence (mandatory):**

```
           indexname           |                                                                                        indexdef
-------------------------------+----------------------------------------------------------------------------------------------------------------------------------
 Identity_pkey                 | CREATE UNIQUE INDEX "Identity_pkey" ON identity."Identity" USING btree (id)
 Identity_registered_email_key | CREATE UNIQUE INDEX "Identity_registered_email_key" ON identity."Identity" USING btree (lower(email)) WHERE ((kind = 'REGISTERED'::identity."IdentityKind") AND ("deletedAt" IS NULL))
(2 rows)
```

- **Integration test:** 6/6 PASS (Testcontainers applies the edited migration via `migrate deploy`; the migration list shown during the run includes both `20260718061612_room_lifecycle` and `20260722151900_identity_seam`).
- **Full int suite:** `pnpm --filter @mymozhem/core run test:int` → 3 suites, 17 tests, all PASS (room int-specs unaffected — no FK yet).
- **Other lanes:** `typecheck` PASS, `test` (unit) 55/55 PASS, `lint` PASS.

## TDD Evidence

### RED

Command: `pnpm --filter @mymozhem/core run test:int -- identity-schema`

Output (excerpt):

```
src/identity/identity-schema.int-spec.ts:56:21 - error TS2339: Property 'identity' does not exist on type 'PrismaService'.
...
Test Suites: 1 failed, 1 total
Tests:       0 total
```

Expected because the `Identity` model did not yet exist in the Prisma schema, so the generated client has no `identity` delegate — exactly the failure mode the brief predicts.

### GREEN

Command: `pnpm --filter @mymozhem/core run test:int -- identity-schema`

Output:

```
PASS src/identity/identity-schema.int-spec.ts
  Identity registered-email partial unique index
    ✓ exists in the migrated database (REQ-DEV-006 автотест наличия) (24 ms)
    ✓ rejects a second live REGISTERED row with the same email (60 ms)
    ✓ is case-insensitive (lower() in the index) (9 ms)
    ✓ allows the same email for two GUEST rows (9 ms)
    ✓ allows re-registering an email whose previous REGISTERED row is anonymized (6 ms)
    ✓ allows many rows with NULL email (6 ms)

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
```

## Files changed (commit a74f057)

- Modified: `/Users/alexanderlapygin/Projects/mymozhem/packages/core/prisma/schema.prisma`
- Created: `/Users/alexanderlapygin/Projects/mymozhem/packages/core/prisma/migrations/20260722151900_identity_seam/migration.sql`
- Created: `/Users/alexanderlapygin/Projects/mymozhem/packages/core/src/identity/identity-schema.int-spec.ts`

`git diff --stat` confirms exactly these 3 files; the FROZEN migration `20260718061612_room_lifecycle/migration.sql` is untouched. Working tree clean after commit.

## Self-review findings

- **Completeness:** All 13 brief steps executed in order; every expected output verified. Test file, schema blocks, migration SQL, and commit message used verbatim from the brief.
- **Quality:** Schema and migration comments carry the REQ cross-references (REQ-ID-001, REQ-ID-014, REQ-DEV-006) and the co-change warning tying the index predicate to the future guarded INSERT in RoomService.create (Task 4).
- **Discipline/YAGNI:** No extra models, fields, indexes, or dependencies; lockfile untouched; no files outside the brief's list. One deliberate environmental deviation: the authoring container was published on host port **55432** instead of 5432 because port 5432 is already bound by an unrelated running container (`lt-pg`), which I did not touch. This affects only the ephemeral authoring DB URL, not any committed artifact; the Testcontainers path (what tests and CI use) is port-agnostic.
- **Testing hygiene:** RED→GREEN followed strictly (failing test committed-conceptually before schema existed; verified TS2339 failure first). The authoring container was stopped/removed after Step 9 evidence; only pre-existing containers remain. No test ran against anything but ephemeral Testcontainers/throwaway Postgres.

## Issues or concerns

None blocking. Note for Task 3/4: the generated Prisma client exposes `prisma.identity` with `kind: $Enums.IdentityKind` as specified in the brief's interface — Task 3 can rely on `prisma.identity.create`.
