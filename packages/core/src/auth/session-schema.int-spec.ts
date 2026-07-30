import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';

describe('identity."Session" schema (REQ-ID-007)', () => {
  let db: TestDb;
  beforeAll(async () => { db = await startTestDb(); }, 120000);
  afterAll(async () => { await db.stop(); });

  it('table exists in the identity schema', async () => {
    const rows = await db.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM information_schema.tables
      WHERE table_schema = 'identity' AND table_name = 'Session'`;
    expect(Number(rows[0].count)).toBe(1);
  });

  it('refreshTokenHash is unique', async () => {
    const rows = await db.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pg_indexes
      WHERE schemaname = 'identity' AND tablename = 'Session'
        AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%refreshTokenHash%'`;
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(1);
  });
});
