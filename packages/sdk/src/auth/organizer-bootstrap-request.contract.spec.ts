import { organizerBootstrapRequestSchema } from './organizer-bootstrap-request';

describe('organizerBootstrapRequest contract (ADR-012)', () => {
  it('accepts a non-empty setupToken', () => {
    expect(organizerBootstrapRequestSchema.safeParse({ setupToken: 'x'.repeat(32) }).success).toBe(true);
  });
  it.each([[{}], [{ setupToken: '' }], [{ setupToken: 'x', extra: 1 }], ['nope']])(
    'rejects %j',
    (v) => expect(organizerBootstrapRequestSchema.safeParse(v).success).toBe(false),
  );
});
