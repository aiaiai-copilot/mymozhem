import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';

// ADR-012: таблица IdentityProvider удалена; единственность организатора —
// частичный индекс Identity_single_registered_key (REQ-DEV-006: автотест наличия).
describe('identity schema after drop_identity_provider (ADR-012)', () => {
  let db: TestDb;
  beforeAll(async () => { db = await startTestDb(); }, 120000);
  afterAll(async () => { await db.stop(); });

  it('drops identity."IdentityProvider"', async () => {
    const rows = await db.prisma.$queryRaw<{ name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'identity' AND table_name = 'IdentityProvider'`;
    expect(rows).toEqual([]);
  });

  it('has Identity_single_registered_key partial unique index', async () => {
    const rows = await db.prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'identity' AND tablename = 'Identity' AND indexname = 'Identity_single_registered_key'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('UNIQUE');
    expect(rows[0].indexdef).toContain('REGISTERED');
    expect(rows[0].indexdef).toContain('deletedAt');
  });
});
