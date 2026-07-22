import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';

// REQ-RT-001: таблица append-only лога существует в мигрированной БД с контрактной
// формой — составной PK (roomId, seq) [= unique(roomId, seq)], Restrict FK на
// core-таблицы без каскадов (REQ-CORE-003), контрактные строки visibility.
describe('Realtime LogEvent table (migration presence)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  it('exists in schema realtime', async () => {
    const rows = await db.prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'realtime' AND tablename = 'LogEvent'
    `;
    expect(rows).toHaveLength(1);
  });

  it('has composite PK (roomId, seq) — unique(roomId, seq) of REQ-RT-001', async () => {
    const rows = await db.prisma.$queryRaw<{ constraintdef: string }[]>`
      SELECT pg_get_constraintdef(oid) AS constraintdef
      FROM pg_constraint
      WHERE conrelid = 'realtime."LogEvent"'::regclass AND contype = 'p'
    `;
    expect(rows).toHaveLength(1);
    // pg_get_constraintdef канонизирует идентификаторы: "roomId" квотится
    // (mixed-case), seq — нет (валидный lowercase-идентификатор).
    expect(rows[0].constraintdef).toBe('PRIMARY KEY ("roomId", seq)');
  });

  it('has exactly two Restrict FKs to the core tables (REQ-CORE-003, no cascades)', async () => {
    const rows = await db.prisma.$queryRaw<{ conname: string; constraintdef: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS constraintdef
      FROM pg_constraint
      WHERE conrelid = 'realtime."LogEvent"'::regclass AND contype = 'f'
      ORDER BY conname
    `;
    expect(rows.map((r) => r.conname)).toEqual([
      'LogEvent_actorId_fkey',
      'LogEvent_roomId_fkey',
    ]);
    for (const row of rows) {
      expect(row.constraintdef).toContain('ON DELETE RESTRICT');
    }
  });

  it('stores contract-string visibility values (module-private with a hyphen)', async () => {
    const rows = await db.prisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'realtime' AND t.typname = 'EventVisibility'
      ORDER BY e.enumsortorder
    `;
    expect(rows.map((r) => r.enumlabel)).toEqual(['public', 'organizer', 'module-private']);
  });
});
