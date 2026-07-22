import { IDENTITY_KINDS, identityKindSchema } from './identity-kind';
import { validKinds, invalidKinds } from './identity-kind.fixtures';

describe('identityKind contract (REQ-ID-001)', () => {
  it('declares exactly the two kinds of REQ-ID-001', () => {
    expect([...IDENTITY_KINDS]).toEqual(['REGISTERED', 'GUEST']);
  });

  it.each(validKinds)('accepts %s', (kind) => {
    expect(identityKindSchema.safeParse(kind).success).toBe(true);
  });

  it.each(invalidKinds.map((v) => [String(v), v] as const))('rejects %s', (_name, v) => {
    expect(identityKindSchema.safeParse(v).success).toBe(false);
  });
});
