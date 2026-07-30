import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { TEST_CONFIG } from '../testing/test-config';
import { EventLogService } from '../realtime/event-log.service';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { RoomService } from '../room/room.service';
import { IdentityService } from '../identity/identity.service';
import { MembershipService } from '../membership/membership.service';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { TokenService } from './token.service';
import { AUTH_ERROR_CODES, AuthError } from './auth.errors';

const ORG = '00000000-0000-0000-0000-000000000001';
const IP = '203.0.113.7';

describe('TokenService.rotate (REQ-ID-007/016)', () => {
  let db: TestDb;
  let roomService: RoomService;
  let membership: MembershipService;
  let tokens: TokenService;

  // Guest with exactly one membership in a fresh DRAFT room — the only live
  // session-issuing flow in this slice (design §4).
  const seedGuestWithRoom = async () => {
    const room = await roomService.create(ORG);
    const joined = await membership.join({ code: room.code, displayName: 'Гость', ip: IP });
    return { room, identity: joined.identity };
  };

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    membership = new MembershipService(
      db.prisma,
      new IdentityService(db.prisma),
      new JoinRateLimiter(1000),
      TEST_CONFIG,
    );
    roomService = new RoomService(
      db.prisma,
      new EventLogService(),
      new AppRegistryService([]),
      membership,
      TEST_CONFIG,
    );
    tokens = new TokenService(db.prisma, TEST_CONFIG);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE identity."Session", membership."Membership", room."Room" CASCADE',
    );
  });

  it('rotates: old refresh dies, new pair works, familyId preserved', async () => {
    const { room, identity } = await seedGuestWithRoom();
    const first = await tokens.issueGuestTokens(identity.id, room.id);
    const second = await tokens.rotate(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    const claims = tokens.verifyAccessToken(second.accessToken);
    expect(claims).toMatchObject({ sub: identity.id, kind: 'GUEST', roomId: room.id });
    const familyId = (await db.prisma.session.findFirstOrThrow()).familyId;
    const sessions = await db.prisma.session.findMany({ where: { familyId } });
    expect(sessions).toHaveLength(2);
    expect(new Set(sessions.map((s) => s.familyId)).size).toBe(1);
    await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(AuthError); // старый мёртв
  });

  it('reuse of an already-rotated token revokes the whole family (REQ-ID-007)', async () => {
    const { room, identity } = await seedGuestWithRoom();
    const first = await tokens.issueGuestTokens(identity.id, room.id);
    const second = await tokens.rotate(first.refreshToken);
    await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(AuthError); // reuse → revoke
    await expect(tokens.rotate(second.refreshToken)).rejects.toThrow(AuthError); // новый тоже мёртв
    const alive = await db.prisma.session.count({ where: { revokedAt: null } });
    expect(alive).toBe(0);
  });

  it('rejects an unknown refresh token', async () => {
    const err = await tokens.rotate('nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).code).toBe(AUTH_ERROR_CODES.SESSION_INVALID);
  });

  // Терминальность через cancel (DRAFT→CANCELLED): activate требует configure
  // (ROOM_NOT_CONFIGURED), а ветка rotate проверяет оба терминальных статуса.
  it('rejects refresh when the room is terminal (REQ-ID-016)', async () => {
    const { room, identity } = await seedGuestWithRoom();
    const first = await tokens.issueGuestTokens(identity.id, room.id);
    await roomService.cancel(room.id);
    const err = await tokens.rotate(first.refreshToken).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).code).toBe(AUTH_ERROR_CODES.SESSION_INVALID);
  });

  it('rejects refresh when guest TTL expired (REQ-ID-016)', async () => {
    const { room, identity } = await seedGuestWithRoom();
    const first = await tokens.issueGuestTokens(identity.id, room.id);
    await db.prisma.identity.update({
      where: { id: identity.id },
      data: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) },
    });
    await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(AuthError);
  });

  it('rejects refresh when identity is soft-deleted', async () => {
    const { room, identity } = await seedGuestWithRoom();
    const first = await tokens.issueGuestTokens(identity.id, room.id);
    await db.prisma.identity.update({ where: { id: identity.id }, data: { deletedAt: new Date() } });
    await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(AuthError);
  });

  it('rejects refresh when session is expired', async () => {
    const { room, identity } = await seedGuestWithRoom();
    const first = await tokens.issueGuestTokens(identity.id, room.id);
    await db.prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(AuthError);
  });

  it('only one of two concurrent rotations wins; family NOT revoked on race', async () => {
    const { room, identity } = await seedGuestWithRoom();
    const first = await tokens.issueGuestTokens(identity.id, room.id);
    const results = await Promise.allSettled([
      tokens.rotate(first.refreshToken),
      tokens.rotate(first.refreshToken),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    // Ротированная сессия помечается replacedById, НЕ revokedAt (design §4: revokedAt —
    // только отзыв). «Живая» = ни ротирована, ни отозвана.
    const alive = await db.prisma.session.count({ where: { revokedAt: null, replacedById: null } });
    expect(alive).toBe(1); // семейство живо, победитель может продолжать
    const winner = (ok[0] as PromiseFulfilledResult<{ refreshToken: string }>).value;
    await expect(tokens.rotate(winner.refreshToken)).resolves.toBeDefined();
  });
});
