import { setupTokenMatches } from './setup-token';

describe('setupTokenMatches (ADR-012, REQ-SEC-002)', () => {
  const expected = 'correct-token-32-bytes-long-string!';
  it('matches identical strings', () => expect(setupTokenMatches(expected, expected)).toBe(true));
  it('rejects a wrong token of the same length', () =>
    expect(setupTokenMatches('x'.repeat(expected.length), expected)).toBe(false));
  it('rejects without leaking length (shorter/longer candidates)', () => {
    expect(setupTokenMatches('short', expected)).toBe(false);
    expect(setupTokenMatches(expected + 'x', expected)).toBe(false);
    expect(setupTokenMatches('', expected)).toBe(false);
  });
});
