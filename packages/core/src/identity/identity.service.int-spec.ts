import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { IdentityService } from './identity.service';

// REQ-ID-003: гость создаётся по коду комнаты и имени; этот сервис — первый
// identity-пишущий поток (identity seam design §6).
describe('IdentityService.createGuest (REQ-ID-003)', () => {
  let db: TestDb;
  let service: IdentityService;

  beforeAll(async () => {
    db = await startTestDb();
    service = new IdentityService(db.prisma);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE identity."Identity" CASCADE');
  });

  it('creates a GUEST identity with a trimmed display name', async () => {
    const guest = await service.createGuest('  Саша  ');
    expect(guest.kind).toBe('GUEST');
    expect(guest.displayName).toBe('Саша');
    expect(guest.email).toBeNull();
    expect(guest.deletedAt).toBeNull();
  });

  it('rejects an empty-after-trim name', async () => {
    await expect(service.createGuest('   ')).rejects.toThrow();
  });

  it('rejects a name over 40 chars', async () => {
    await expect(service.createGuest('x'.repeat(41))).rejects.toThrow();
  });
});
