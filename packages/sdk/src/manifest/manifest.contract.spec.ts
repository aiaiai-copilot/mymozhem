import { appManifestSchema, contractRangeSchema } from './manifest.schema';
import { invalidManifestCases, validManifests } from './manifest.fixtures';

describe('app manifest contract', () => {
  it.each(validManifests.map((m, i) => [i, m] as const))(
    'accepts valid fixture #%i',
    (_i, manifest) => {
      expect(appManifestSchema.safeParse(manifest).success).toBe(true);
    },
  );

  it.each(invalidManifestCases.map((c) => [c.name, c.value] as const))(
    'rejects invalid fixture: %s',
    (_name, value) => {
      expect(appManifestSchema.safeParse(value).success).toBe(false);
    },
  );

  it('accepts a bounded-above semver range', () => {
    expect(contractRangeSchema.safeParse('^1.0.0').success).toBe(true);
    expect(contractRangeSchema.safeParse('~1.0.0').success).toBe(true);
    expect(contractRangeSchema.safeParse('>=1.0.0 <2.0.0').success).toBe(true);
  });

  // REQ-CTR-004: a range with no upper bound is not a compatibility declaration —
  // it claims a contract major that does not exist yet (owner decision 2026-07-18).
  // '>=0.0.0-0' is the sharp case: it constrains almost nothing yet does not
  // normalize to '*', so a '*'-only check would miss it.
  it('rejects a well-formed range that is not bounded above', () => {
    expect(contractRangeSchema.safeParse('>=1.0.0').success).toBe(false);
    expect(contractRangeSchema.safeParse('>=0.0.0-0').success).toBe(false);
    expect(contractRangeSchema.safeParse('*').success).toBe(false);
  });

  it('refuses a malformed range', () => {
    expect(contractRangeSchema.safeParse('garbage!!').success).toBe(false);
  });
});
