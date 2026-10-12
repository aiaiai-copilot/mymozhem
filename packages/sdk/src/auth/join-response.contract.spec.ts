import { joinResponseSchema } from './join-response';

describe('joinResponse contract (ADR-012: серверный псевдоним в ответе)', () => {
  it('accepts token pair + displayName', () => {
    expect(
      joinResponseSchema.safeParse({ accessToken: 'a', tokenType: 'Bearer', expiresIn: 900, displayName: 'Лиса-42' }).success,
    ).toBe(true);
  });
  it('rejects missing displayName (сервер обязан назначить)', () => {
    expect(joinResponseSchema.safeParse({ accessToken: 'a', tokenType: 'Bearer', expiresIn: 900 }).success).toBe(false);
  });
});
