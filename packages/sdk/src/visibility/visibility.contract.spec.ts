import {
  VISIBILITY_LEVELS,
  visibilitySchema,
  exposureRank,
  isWithinCeiling,
  DEFAULT_VISIBILITY,
} from './visibility';
import { ceilingCases } from './visibility.fixtures';

describe('visibility contract', () => {
  it('declares exactly the three levels of REQ-CORE-005', () => {
    expect([...VISIBILITY_LEVELS]).toEqual(['public', 'organizer', 'module-private']);
  });

  it('rejects an unknown level', () => {
    expect(visibilitySchema.safeParse('secret').success).toBe(false);
  });

  it('orders levels by exposure: public > organizer > module-private', () => {
    expect(exposureRank('public')).toBeGreaterThan(exposureRank('organizer'));
    expect(exposureRank('organizer')).toBeGreaterThan(exposureRank('module-private'));
  });

  it.each(ceilingCases.map((c) => [c.name, c.actual, c.ceiling, c.within] as const))(
    'ceiling rule: %s',
    (_name, actual, ceiling, within) => {
      expect(isWithinCeiling(actual, ceiling)).toBe(within);
    },
  );

  it('defaults to the most protected level (fail-safe, ADR-008)', () => {
    expect(DEFAULT_VISIBILITY).toBe('module-private');
  });
});
