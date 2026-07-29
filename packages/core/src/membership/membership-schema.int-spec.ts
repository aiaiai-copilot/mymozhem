import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';

const ORG = '00000000-0000-0000-0000-000000000001';

// REQ-ID-011 + REQ-DEV-006: таблица membership и частичный индекс единственного
// организатора существуют и ведут себя как специфицировано (design §2).
describe('Membership schema', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE membership."Membership", room."Room" CASCADE',
    );
  });

  const createRoom = (code: string) =>
    db.prisma.room.create({ data: { organizerId: ORG, code } });

  it('single-organizer partial unique index exists (REQ-DEV-006 presence test)', async () => {
    const rows = await db.prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'membership' AND indexname = 'Membership_single_organizer_key'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/^CREATE UNIQUE INDEX/);
    expect(rows[0].indexdef).toContain('"roomId"');
    expect(rows[0].indexdef).toMatch(/role = 'ORGANIZER'/);
  });

  it('enforces one ORGANIZER per room at the database level', async () => {
    const room = await createRoom('testcode1');
    const guest = await seedIdentity(db.prisma, { kind: 'GUEST' });
    await db.prisma.membership.create({
      data: { roomId: room.id, identityId: ORG, role: 'ORGANIZER' },
    });
    await expect(
      db.prisma.membership.create({
        data: { roomId: room.id, identityId: guest.id, role: 'ORGANIZER' },
      }),
    ).rejects.toThrow(/[Uu]nique constraint|duplicate key/);
  });

  it('allows a second ORGANIZER membership in a DIFFERENT room', async () => {
    const roomA = await createRoom('testcode1');
    const roomB = await createRoom('testcode2');
    await db.prisma.membership.create({
      data: { roomId: roomA.id, identityId: ORG, role: 'ORGANIZER' },
    });
    await db.prisma.membership.create({
      data: { roomId: roomB.id, identityId: ORG, role: 'ORGANIZER' },
    });
    expect(await db.prisma.membership.count()).toBe(2);
  });

  it('enforces unique(roomId, identityId)', async () => {
    const room = await createRoom('testcode1');
    const guest = await seedIdentity(db.prisma, { kind: 'GUEST' });
    await db.prisma.membership.create({
      data: { roomId: room.id, identityId: guest.id, role: 'PARTICIPANT' },
    });
    await expect(
      db.prisma.membership.create({
        data: { roomId: room.id, identityId: guest.id, role: 'SPECTATOR' },
      }),
    ).rejects.toThrow(/[Uu]nique constraint|duplicate key/);
  });

  it('enforces unique room codes', async () => {
    await createRoom('testcode1');
    await expect(createRoom('testcode1')).rejects.toThrow(
      /[Uu]nique constraint|duplicate key/,
    );
  });
});
