import { TokenService } from './token.service';
import { AuthError } from './auth.errors';
import { TEST_CONFIG } from '../testing/test-config';

const makeService = () => {
  const sessions: Array<Record<string, unknown>> = [];
  const sessionCreate = jest.fn().mockImplementation(({ data }) => {
    const row = { id: 'sess-1', ...data };
    sessions.push(row);
    return Promise.resolve(row);
  });
  const sessionFindFirstOrThrow = jest
    .fn()
    .mockImplementation(({ where }: { where?: { identityId?: string } } = {}) => {
      const row = where?.identityId
        ? sessions.find((s) => s.identityId === where.identityId)
        : sessions[sessions.length - 1];
      if (!row) return Promise.reject(new Error('session not found'));
      return Promise.resolve(row);
    });
  const prisma = { session: { create: sessionCreate, findFirstOrThrow: sessionFindFirstOrThrow } };
  const service = new TokenService(prisma as never, TEST_CONFIG);
  return { service, prisma, sessionCreate };
};

describe('TokenService.issueGuestTokens (REQ-ID-007/016)', () => {
  it('signs HS256 access with guest claims and stores only the refresh hash', async () => {
    const { service, sessionCreate } = makeService();
    const issued = await service.issueGuestTokens('ident-1', 'room-1');

    const claims = service.verifyAccessToken(issued.accessToken);
    expect(claims).toMatchObject({ sub: 'ident-1', sid: 'sess-1', kind: 'GUEST', roomId: 'room-1' });
    expect(issued.expiresIn).toBe(TEST_CONFIG.ACCESS_TOKEN_TTL);

    const stored = sessionCreate.mock.calls[0][0].data;
    expect(stored.identityId).toBe('ident-1');
    expect(stored.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex, не сам токен
    expect(stored.refreshTokenHash).not.toBe(issued.refreshToken);
    expect(stored.familyId).toEqual(expect.any(String));
  });

  it('issueGuestTokens returns kind GUEST', async () => {
    const { service } = makeService();
    const issued = await service.issueGuestTokens('id-1', 'room-1');
    expect(issued.kind).toBe('GUEST');
  });

  it('caps session expiry by min(REFRESH_TOKEN_TTL, GUEST_TTL) (REQ-ID-016, GUEST-ветка)', async () => {
    const { service, sessionCreate } = makeService();
    await service.issueGuestTokens('ident-1', 'room-1');
    const expiresAt: Date = sessionCreate.mock.calls[0][0].data.expiresAt;
    const expectedMs = Math.min(TEST_CONFIG.REFRESH_TOKEN_TTL, TEST_CONFIG.GUEST_TTL) * 1000;
    expect(Math.abs(expiresAt.getTime() - (Date.now() + expectedMs))).toBeLessThan(5000);
  });

  it('issues distinct refresh tokens per call', async () => {
    const { service } = makeService();
    const a = await service.issueGuestTokens('i', 'r');
    const b = await service.issueGuestTokens('i', 'r');
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });
});

describe('TokenService.issueRegisteredTokens (REQ-ID-015/016, REGISTERED-ветка)', () => {
  it('issueRegisteredTokens: claims без roomId, TTL без guest-cap', async () => {
    const { service, prisma } = makeService();
    const issued = await service.issueRegisteredTokens('id-registered');
    expect(issued.kind).toBe('REGISTERED');
    const claims = service.verifyAccessToken(issued.accessToken);
    expect(claims.kind).toBe('REGISTERED');
    expect(claims.roomId).toBeUndefined();
    // TEST_CONFIG: REFRESH_TOKEN_TTL (30 сут) > GUEST_TTL (1 сут) — registered не наследует cap.
    const session = await prisma.session.findFirstOrThrow({ where: { identityId: 'id-registered' } });
    const expectedMs = TEST_CONFIG.REFRESH_TOKEN_TTL * 1000;
    expect(Math.abs(session.expiresAt.getTime() - (Date.now() + expectedMs))).toBeLessThan(5_000);
  });
});

describe('TokenService.rotate (REGISTERED-ветка, REQ-ID-007/016)', () => {
  it('registered identity: rotate → TTL без guest-cap, kind REGISTERED, без roomId', async () => {
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      session: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sess-old',
          identityId: 'id-registered',
          familyId: 'fam-1',
          replacedById: null,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        updateMany: jest.fn(),
      },
      identity: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'id-registered',
          kind: 'REGISTERED',
          deletedAt: null,
          createdAt: new Date(),
        }),
      },
      $transaction: jest.fn().mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          session: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
              created.push(data);
              return Promise.resolve({ ...data });
            }),
          },
        }),
      ),
    };
    const service = new TokenService(prisma as never, TEST_CONFIG);
    const issued = await service.rotate('registered-refresh-token');
    expect(issued.kind).toBe('REGISTERED');
    const claims = service.verifyAccessToken(issued.accessToken);
    expect(claims.kind).toBe('REGISTERED');
    expect(claims.roomId).toBeUndefined();
    // Новая сессия — REFRESH_TOKEN_TTL, не min(REFRESH, GUEST_TTL).
    const expectedMs = TEST_CONFIG.REFRESH_TOKEN_TTL * 1000;
    expect(Math.abs((created[0].expiresAt as Date).getTime() - (Date.now() + expectedMs))).toBeLessThan(5_000);
  });
});

describe('TokenService.verifyAccessToken', () => {
  it('rejects a token signed with another secret', async () => {
    const { service } = makeService();
    const { default: jwt } = await import('jsonwebtoken');
    const foreign = jwt.sign({ sub: 'x', sid: 'y', kind: 'GUEST', roomId: 'r' }, 'wrong-secret-wrong-secret-32bytes!', { algorithm: 'HS256' });
    expect(() => service.verifyAccessToken(foreign)).toThrow(AuthError);
  });

  it('rejects a malformed token', () => {
    const { service } = makeService();
    expect(() => service.verifyAccessToken('not-a-jwt')).toThrow(AuthError);
  });
});
