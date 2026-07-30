import { TokenService } from './token.service';
import { AuthError } from './auth.errors';
import { TEST_CONFIG } from '../testing/test-config';

const makeService = () => {
  const sessionCreate = jest.fn().mockImplementation(({ data }) =>
    Promise.resolve({ id: 'sess-1', ...data }),
  );
  const prisma = { session: { create: sessionCreate } };
  const service = new TokenService(prisma as never, TEST_CONFIG);
  return { service, sessionCreate };
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

  it('caps session expiry by min(REFRESH_TOKEN_TTL, GUEST_TTL) (REQ-ID-016)', async () => {
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
