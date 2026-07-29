import { DISPLAY_NAME_MAX_LENGTH, displayNameSchema } from './display-name';
import { validDisplayNames, invalidDisplayNames } from './display-name.fixtures';

describe('displayName contract (REQ-ID-003)', () => {
  it.each(validDisplayNames)('accepts %s', (name) => {
    expect(displayNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(invalidDisplayNames.map((v) => [String(v), v] as const))('rejects %s', (_name, v) => {
    expect(displayNameSchema.safeParse(v).success).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    expect(displayNameSchema.parse('  Alex  ')).toBe('Alex');
  });

  it('accepts exactly DISPLAY_NAME_MAX_LENGTH chars and rejects one more', () => {
    expect(displayNameSchema.safeParse('x'.repeat(DISPLAY_NAME_MAX_LENGTH)).success).toBe(true);
    expect(displayNameSchema.safeParse('x'.repeat(DISPLAY_NAME_MAX_LENGTH + 1)).success).toBe(false);
  });
});
