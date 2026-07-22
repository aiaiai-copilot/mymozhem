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
