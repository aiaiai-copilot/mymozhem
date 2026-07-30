import { tokenResponseSchema } from './token-response';

describe('tokenResponse contract (REQ-ID-016)', () => {
  it('accepts a well-formed response', () => {
    expect(tokenResponseSchema.safeParse({ accessToken: 'a.b.c', tokenType: 'Bearer', expiresIn: 900 }).success).toBe(true);
  });
  it.each([
    { accessToken: '', tokenType: 'Bearer', expiresIn: 900 },
    { accessToken: 'a.b.c', tokenType: 'bearer', expiresIn: 900 },
    { accessToken: 'a.b.c', tokenType: 'Bearer', expiresIn: 0 },
    { accessToken: 'a.b.c', tokenType: 'Bearer', expiresIn: 900, refreshToken: 'x' }, // strict
  ])('rejects %j', (v) => {
    expect(tokenResponseSchema.safeParse(v).success).toBe(false);
  });
});
