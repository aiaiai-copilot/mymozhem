import { z } from 'zod';
import { CONTRACT_VERSION } from '../contract-version';
import { ContractError } from '../errors/error-codes';
import type { Visibility } from '../visibility/visibility';
import { assertVisibilityAnnotations } from './app-settings-visibility';
import {
  appManifestSchema,
  type AppManifest,
  type JsonSchemaObject,
} from './manifest.schema';

// The authoring surface (design §4.6): an app writes zod — types and DX — while the
// REGISTERED artifact is JSON Schema. That is what makes REQ-RT-004 an invariant
// held by data: the snapshot sits in the core's storage under
// (appId, manifestVersion), so a module cannot break an active room's validation by
// deleting last version's code.
export type AppDefinition = {
  appId: string;
  manifestVersion: number;
  // Defaults to the current major of the contract (REQ-CTR-004).
  contractRange?: string;
  appSettings: z.ZodType;
  // Short names; the core prefixes the namespace itself (design §4.1).
  events: Record<string, { schema: z.ZodType; visibility: Visibility }>;
};

type ZodInternals = { _zod?: { def?: { checks?: unknown[] } } };
type CheckInternals = { _zod?: { def?: { check?: string } } };

// A custom refinement reports check === 'custom'; ordinary checks report their own
// kind ('min_length', 'greater_than', …) and convert fine. Testing for a non-empty
// checks array would reject legal schemas.
const hasCustomCheck = (schema: unknown): boolean =>
  ((schema as ZodInternals)?._zod?.def?.checks ?? []).some(
    (check) => (check as CheckInternals)?._zod?.def?.check === 'custom',
  );

// The conversion guard (design §6).
//
// z.toJSONSchema drops .refine()/.superRefine() SILENTLY while throwing on
// date/bigint/transform. Silent loss is the defect class ADR-008 exists to prevent:
// the app is convinced the core enforces its rule, and the core never received it.
// So a manifest carrying one is refused outright.
//
// This reads a zod internal (_zod.def.checks) on purpose. The cure is the project's
// own principle: the guard is covered by a fixture, so a zod upgrade that breaks
// detection turns CI red instead of quietly opening the gate.
export const toRegisteredSchema = (schema: z.ZodType): JsonSchemaObject => {
  try {
    // `override` is invoked for every subschema, so it walks the tree for us —
    // nested refinements and refinements inside arrays included.
    const json = z.toJSONSchema(schema, {
      override: (ctx) => {
        if (hasCustomCheck(ctx.zodSchema)) {
          throw new ContractError(
            'SCHEMA_NOT_REPRESENTABLE',
            'custom refinement (.refine/.superRefine) cannot be represented in JSON Schema and would be dropped silently',
          );
        }
      },
    });
    return { ...json } as JsonSchemaObject;
  } catch (err) {
    if (err instanceof ContractError) {
      throw err;
    }
    // date / bigint / transform: zod throws by itself — re-wrap as a typed code so
    // nothing raw reaches the caller (REQ-SEC-006).
    throw new ContractError(
      'SCHEMA_NOT_REPRESENTABLE',
      err instanceof Error ? err.message : String(err),
    );
  }
};

// Where zod stops being the artifact and JSON Schema starts. The core validates the
// FORM from this snapshot; semantics that need room state stay with the app
// (design §4.6, REQ-RT-013).
export const defineApp = (definition: AppDefinition): AppManifest => {
  const appSettings = toRegisteredSchema(definition.appSettings);
  assertVisibilityAnnotations(appSettings);

  const events = Object.fromEntries(
    Object.entries(definition.events).map(([shortName, event]) => [
      shortName,
      { schema: toRegisteredSchema(event.schema), visibility: event.visibility },
    ]),
  );

  const manifest = {
    appId: definition.appId,
    manifestVersion: definition.manifestVersion,
    contractRange: definition.contractRange ?? `^${CONTRACT_VERSION}`,
    appSettings,
    events,
  };

  const parsed = appManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new ContractError('MANIFEST_INVALID', parsed.error.message);
  }

  return parsed.data;
};
