import {
  appManifestSchema,
  assertContractRangeSatisfied,
  ContractError,
  type AppManifest,
} from '@mymozhem/sdk';

// Validate a manifest crossing the SDK boundary and return the trusted snapshot.
// The manifest arrives already converted to JSON Schema by the app's defineApp call,
// so the core re-validates its FORM (defense-in-depth) and checks that the RUNNING
// contract version satisfies the declared range (REQ-CTR-004). It does NOT re-run the
// conversion guard — there is no zod left to convert (design §3).
export const registerManifest = (input: unknown): AppManifest => {
  const parsed = appManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ContractError('MANIFEST_INVALID', parsed.error.message);
  }
  assertContractRangeSatisfied(parsed.data.contractRange);
  return parsed.data;
};

export type AppRegistry = {
  getManifest(appId: string, manifestVersion: number): AppManifest | undefined;
};

const registryKey = (appId: string, manifestVersion: number): string =>
  `${appId}@${manifestVersion}`;

// Build the immutable registry once, from the manifests compiled into this artifact.
// REQ-CORE-004: constructed once and frozen — no mutable module-level state. A bad
// manifest throws (fail-closed). A duplicate (appId, manifestVersion) is a compiled-in
// misconfiguration, so it crashes assembly with a plain Error rather than a typed
// ContractError (design §4, micro-decision 1).
export const buildAppRegistry = (manifests: readonly unknown[]): AppRegistry => {
  const byKey = new Map<string, AppManifest>();
  for (const input of manifests) {
    const manifest = registerManifest(input);
    const key = registryKey(manifest.appId, manifest.manifestVersion);
    if (byKey.has(key)) {
      throw new Error(`App registry: duplicate manifest registration for ${key}`);
    }
    byKey.set(key, manifest);
  }
  return Object.freeze({
    getManifest: (appId: string, manifestVersion: number): AppManifest | undefined =>
      byKey.get(registryKey(appId, manifestVersion)),
  });
};
