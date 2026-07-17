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

// The allowlist of check kinds known to survive z.toJSONSchema intact. Ordinary
// bounds ('min_length', 'greater_than', …) convert fine — testing for a non-empty
// checks array would reject legal schemas like .min(1). Everything NOT on this list
// is refused, not just 'custom' (.refine()/.superRefine()): zod also has 'overwrite'
// checks (.trim(), .toLowerCase(), …) that convert with NO trace in the JSON Schema
// output, same silent-loss defect as a refinement. A denylist of the kinds known
// today would miss the next one zod adds; an allowlist is fail-closed by
// construction, so an unrecognised kind is refused rather than let through.
//
// This list is DERIVED, not enumerated by hand: for each zod check kind, convert a
// base schema with the check applied and the same base without it, and compare the
// two z.toJSONSchema outputs. A check that leaves a trace (the outputs differ) is
// representable and belongs on the list; a check that leaves no trace (the outputs
// are identical, e.g. 'custom' from .refine()/.superRefine(), 'overwrite' from
// .trim()/.toLowerCase()) is a silent loss and must stay refused. Re-run that trace
// test against the installed zod version before adding or removing a kind — this
// comment records the method, not a substitute for running it.
const REPRESENTABLE_CHECK_KINDS = new Set([
  'min_length',
  'max_length',
  'length_equals',
  'string_format',
  'number_format',
  'greater_than',
  'less_than',
  'multiple_of',
]);

// Returns the offending check kind (so the refusal message can name it) or
// `undefined` if every check on this schema is on the allowlist.
const findUnrepresentableCheckKind = (schema: unknown): string | undefined => {
  const checks = (schema as ZodInternals)?._zod?.def?.checks ?? [];
  for (const check of checks) {
    const kind = (check as CheckInternals)?._zod?.def?.check;
    if (!REPRESENTABLE_CHECK_KINDS.has(kind ?? '')) {
      return kind ?? '(unknown check kind)';
    }
  }
  return undefined;
};

// The conversion guard (design §6).
//
// z.toJSONSchema drops .refine()/.superRefine() and 'overwrite' checks (.trim(),
// .toLowerCase(), …) SILENTLY while throwing on date/bigint/transform. Silent loss
// is the defect class ADR-008 exists to prevent: the app is convinced the core
// enforces its rule, and the core never received it. So a manifest carrying one is
// refused outright.
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
        const unrepresentableKind = findUnrepresentableCheckKind(ctx.zodSchema);
        if (unrepresentableKind !== undefined) {
          throw new ContractError(
            'SCHEMA_NOT_REPRESENTABLE',
            `check kind '${unrepresentableKind}' cannot be represented in JSON Schema and would be dropped silently (not in the allowlist of check kinds known to convert intact, e.g. .refine/.superRefine ('custom'), or an overwrite check such as .trim()/.toLowerCase() ('overwrite'))`,
          );
        }
      },
    });
    return json as JsonSchemaObject;
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
