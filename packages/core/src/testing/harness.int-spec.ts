import { startTestDb, type TestDb } from './postgres.testcontainer';
import { seedIdentity } from './seed-identity';

describe('integration harness', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: '00000000-0000-0000-0000-000000000001' });
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  it('applies the migration and can round-trip a Room row', async () => {
    const created = await db.prisma.room.create({
      data: { organizerId: '00000000-0000-0000-0000-000000000001' },
    });
    expect(created.status).toBe('DRAFT');
    expect(created.deletedAt).toBeNull();

    const found = await db.prisma.room.findUnique({ where: { id: created.id } });
    expect(found?.id).toBe(created.id);
  });
});
