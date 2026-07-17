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

  it('accepts any well-formed semver range and refuses nonsense', () => {
    expect(contractRangeSchema.safeParse('^1.0.0').success).toBe(true);
    expect(contractRangeSchema.safeParse('>=1.0.0 <2.0.0').success).toBe(true);
    expect(contractRangeSchema.safeParse('garbage!!').success).toBe(false);
  });
});
