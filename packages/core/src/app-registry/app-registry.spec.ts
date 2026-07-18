import {
  ContractError,
  validManifests,
  invalidManifestCases,
  CONTRACT_VERSION,
} from '@mymozhem/sdk';
import { registerManifest, buildAppRegistry } from './app-registry';

// Returns the thrown ContractError's `code`, or the raw error for a non-ContractError,
// or undefined if nothing threw. Keeps the error-code assertions terse.
const catchCode = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return err instanceof ContractError ? err.code : err;
  }
  return undefined;
};

describe('registerManifest', () => {
  it('returns the parsed manifest for a valid input', () => {
    const manifest = validManifests[0];
    expect(registerManifest(manifest)).toEqual(manifest);
  });

  it.each(invalidManifestCases)(
    'rejects a structurally invalid manifest as MANIFEST_INVALID: $name',
    ({ value }) => {
      expect(catchCode(() => registerManifest(value))).toBe('MANIFEST_INVALID');
    },
  );

  it('rejects an unbounded-above contract range as MANIFEST_INVALID', () => {
    const manifest = { ...validManifests[0], contractRange: '>=1.0.0' };
    expect(catchCode(() => registerManifest(manifest))).toBe('MANIFEST_INVALID');
  });

  it('rejects a range excluding the running version as CONTRACT_VERSION_INCOMPATIBLE', () => {
    const manifest = { ...validManifests[0], contractRange: '^2.0.0' };
    expect(catchCode(() => registerManifest(manifest))).toBe('CONTRACT_VERSION_INCOMPATIBLE');
  });

  it('accepts a bounded range that includes the running version', () => {
    const manifest = { ...validManifests[0], contractRange: `^${CONTRACT_VERSION}` };
    expect(registerManifest(manifest).contractRange).toBe(`^${CONTRACT_VERSION}`);
  });
});

describe('buildAppRegistry', () => {
  it('resolves every registered manifest by (appId, manifestVersion)', () => {
    const v1 = validManifests[0];
    const v2 = { ...v1, manifestVersion: v1.manifestVersion + 1 };
    const registry = buildAppRegistry([v1, v2]);
    expect(registry.getManifest(v1.appId, v1.manifestVersion)).toEqual(v1);
    expect(registry.getManifest(v2.appId, v2.manifestVersion)).toEqual(v2);
  });

  it('returns undefined for an unknown key', () => {
    const registry = buildAppRegistry([validManifests[0]]);
    expect(registry.getManifest('no-such-app', 999)).toBeUndefined();
  });

  it('builds an empty registry from an empty list', () => {
    const registry = buildAppRegistry([]);
    const { appId, manifestVersion } = validManifests[0];
    expect(registry.getManifest(appId, manifestVersion)).toBeUndefined();
  });

  it('throws a fatal plain Error (not a ContractError) on a duplicate key', () => {
    const dup = [validManifests[0], { ...validManifests[0] }];
    let caught: unknown;
    try {
      buildAppRegistry(dup);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(ContractError);
    expect((caught as Error).message).toMatch(/duplicate manifest registration/);
  });

  it('propagates a per-manifest ContractError when a manifest in the list is invalid', () => {
    expect(catchCode(() => buildAppRegistry([invalidManifestCases[0].value]))).toBe(
      'MANIFEST_INVALID',
    );
  });
});
