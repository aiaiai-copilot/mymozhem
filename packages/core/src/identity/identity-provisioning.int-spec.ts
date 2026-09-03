import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { IDENTITY_ERROR_CODES, IdentityError } from './identity.errors';
import { IdentityService } from './identity.service';

// REQ-ID-015: provisioning REGISTERED-identity по (provider, subject) — вход OAuth-логина.
// Email-политика (решение владельца, design §0.3): email пишется один раз при создании,
// автолинка по email НЕТ, конфликт с живым REGISTERED → EMAIL_CONFLICT.
describe('IdentityService.findOrCreateByProvider (REQ-ID-015)', () => {
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
    // CASCADE снимает и identity."IdentityProvider" (FK на Identity).
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE identity."Identity" CASCADE');
  });

  it('creates a REGISTERED identity and its provider row', async () => {
    const identity = await service.findOrCreateByProvider({
      provider: 'google',
      subject: 'sub-1',
      email: 'a@b.c',
      displayName: 'Alex',
    });

    expect(identity.kind).toBe('REGISTERED');
    expect(identity.email).toBe('a@b.c');
    expect(identity.displayName).toBe('Alex');
    expect(identity.deletedAt).toBeNull();

    const providerRow = await db.prisma.identityProvider.findUnique({
      where: { provider_subject: { provider: 'google', subject: 'sub-1' } },
    });
    expect(providerRow).not.toBeNull();
    expect(providerRow?.email).toBe('a@b.c');
    expect(providerRow?.identityId).toBe(identity.id);
  });

  it('returns the same identity on repeat login and does NOT overwrite email', async () => {
    const first = await service.findOrCreateByProvider({
      provider: 'google',
      subject: 'sub-2',
      email: 'old@b.c',
      displayName: 'Alex',
    });
    const second = await service.findOrCreateByProvider({
      provider: 'google',
      subject: 'sub-2',
      email: 'new@b.c',
      displayName: 'Other',
    });

    expect(second.id).toBe(first.id);
    expect(second.email).toBe('old@b.c');
    const inDb = await db.prisma.identity.findUnique({ where: { id: first.id } });
    expect(inDb?.email).toBe('old@b.c');
  });

  it('rejects EMAIL_CONFLICT when a live REGISTERED identity owns the email (case-insensitive)', async () => {
    await seedIdentity(db.prisma, { kind: 'REGISTERED', email: 'Taken@b.c' });

    const err = await service
      .findOrCreateByProvider({ provider: 'google', subject: 'sub-3', email: 'taken@b.c' })
      .then(
        () => {
          throw new Error('expected EMAIL_CONFLICT');
        },
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(IdentityError);
    expect((err as IdentityError).code).toBe(IDENTITY_ERROR_CODES.EMAIL_CONFLICT);
  });

  it('allows a REGISTERED signup with an email held by a GUEST identity', async () => {
    await seedIdentity(db.prisma, { kind: 'GUEST', email: 'g@b.c' });

    const identity = await service.findOrCreateByProvider({
      provider: 'google',
      subject: 'sub-4',
      email: 'g@b.c',
    });
    expect(identity.kind).toBe('REGISTERED');
    expect(identity.email).toBe('g@b.c');
  });

  it('resolves a race of two first logins to one identity and one provider row', async () => {
    const input = { provider: 'google', subject: 'sub-5', email: 'race@b.c' };
    const results = await Promise.allSettled([
      service.findOrCreateByProvider(input),
      service.findOrCreateByProvider(input),
    ]);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('fulfilled');
    const [a, b] = results as PromiseFulfilledResult<{ id: string }>[];
    expect(a.value.id).toBe(b.value.id);

    const identities = await db.prisma.identity.findMany();
    expect(identities).toHaveLength(1);
    const providerRows = await db.prisma.identityProvider.findMany();
    expect(providerRows).toHaveLength(1);
    expect(providerRows[0].identityId).toBe(a.value.id);
  });

  it('falls back to displayName null when the name violates the SDK schema', async () => {
    const identity = await service.findOrCreateByProvider({
      provider: 'google',
      subject: 'sub-6',
      email: 'name@b.c',
      displayName: 'x'.repeat(41),
    });
    expect(identity.displayName).toBeNull();
  });

  it('fails closed with PROVIDER_IDENTITY_GONE when the linked identity is soft-deleted', async () => {
    const created = await service.findOrCreateByProvider({
      provider: 'google',
      subject: 'sub-7',
      email: 'gone@b.c',
    });
    await db.prisma.identity.update({
      where: { id: created.id },
      data: { deletedAt: new Date() },
    });

    const err = await service
      .findOrCreateByProvider({ provider: 'google', subject: 'sub-7', email: 'gone@b.c' })
      .then(
        () => {
          throw new Error('expected PROVIDER_IDENTITY_GONE');
        },
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(IdentityError);
    expect((err as IdentityError).code).toBe(IDENTITY_ERROR_CODES.PROVIDER_IDENTITY_GONE);
  });
});
