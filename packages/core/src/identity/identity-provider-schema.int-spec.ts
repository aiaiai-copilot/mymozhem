import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';

describe('identity."IdentityProvider" schema (REQ-ID-015, REQ-DEV-006 автотест наличия)', () => {
  let db: TestDb;
  beforeAll(async () => { db = await startTestDb(); }, 120000);
  afterAll(async () => { await db.stop(); });

  it('exists with unique(provider, subject), index(identityId), FK Restrict', async () => {
    const tables = await db.prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'identity' AND tablename = 'IdentityProvider'
    `;
    expect(tables).toHaveLength(1);

    const indexes = await db.prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'identity' AND tablename = 'IdentityProvider'
    `;
    const unique = indexes.find((i) => i.indexname === 'IdentityProvider_provider_subject_key');
    expect(unique?.indexdef).toMatch(/^CREATE UNIQUE INDEX/);
    expect(indexes.some((i) => i.indexname === 'IdentityProvider_identityId_idx')).toBe(true);

    const fks = await db.prisma.$queryRaw<{ pg_get_constraintdef: string }[]>`
      SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conrelid = 'identity."IdentityProvider"'::regclass AND contype = 'f'
    `;
    expect(fks).toHaveLength(1);
    expect(fks[0].pg_get_constraintdef).toContain('REFERENCES identity."Identity"(id)');
    expect(fks[0].pg_get_constraintdef).toContain('ON DELETE RESTRICT');
  });
});
