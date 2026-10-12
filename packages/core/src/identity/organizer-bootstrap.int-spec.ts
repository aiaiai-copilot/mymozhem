import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { IdentityService } from './identity.service';

// ADR-012 §2: bootstrap единственного организатора инстанса. Единственность
// принуждается частичным индексом "Identity_single_registered_key" (T4), гонка
// первых bootstrap'ов разрешается перечитыванием победителя по P2002.
describe('IdentityService.findOrCreateOrganizer (ADR-012, REQ-ID-005)', () => {
  let db: TestDb;
  let identity: IdentityService;

  beforeAll(async () => {
    db = await startTestDb();
    identity = new IdentityService(db.prisma);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE identity."Identity" CASCADE');
  });

  it('creates exactly one REGISTERED under concurrent bootstrap (Review Focus 1)', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => identity.findOrCreateOrganizer()));
    const ids = new Set(results.map((i) => i.id));
    expect(ids.size).toBe(1);
    const count = await db.prisma.identity.count({ where: { kind: 'REGISTERED', deletedAt: null } });
    expect(count).toBe(1);
  });

  it('is idempotent: repeat calls return the same identity with email=NULL', async () => {
    const first = await identity.findOrCreateOrganizer();
    const second = await identity.findOrCreateOrganizer();
    expect(second.id).toBe(first.id);
    expect(first.email).toBeNull();
    expect(first.displayName).toBe('Организатор');
  });
});
