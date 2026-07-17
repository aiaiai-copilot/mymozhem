import { ContractError } from '../errors/error-codes';
import {
  DEFAULT_VISIBILITY,
  visibilitySchema,
  type Visibility,
} from '../visibility/visibility';
import type { JsonSchemaObject } from './manifest.schema';

// The per-property annotation of ADR-008 §1. It survives zod → JSON Schema
// conversion via .meta({ 'x-visibility': ... }) — verified on zod 4.4.3.
export const VISIBILITY_ANNOTATION = 'x-visibility';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const propertiesOf = (appSettings: JsonSchemaObject): Record<string, unknown> =>
  asRecord(appSettings['properties']) ?? {};

// REQ-CORE-008: «отсутствие аннотации трактуется как module-private (fail-safe)».
// Every unreadable shape resolves the same way — the most protected level. To expose
// a property an author must say so explicitly; forgetting closes, never opens.
export const readPropertyVisibility = (
  appSettings: JsonSchemaObject,
  property: string,
): Visibility => {
  const definition = asRecord(propertiesOf(appSettings)[property]);
  if (definition === null) {
    return DEFAULT_VISIBILITY;
  }

  const parsed = visibilitySchema.safeParse(definition[VISIBILITY_ANNOTATION]);
  return parsed.success ? parsed.data : DEFAULT_VISIBILITY;
};

// The whole map, for the core's projection builder (a later plan): it projects
// appSettings by the requester's level exactly as it projects state and events
// (REQ-CORE-005), instead of filtering fields by hand — which the norm forbids.
export const appSettingsVisibilityMap = (
  appSettings: JsonSchemaObject,
): Record<string, Visibility> =>
  Object.fromEntries(
    Object.keys(propertiesOf(appSettings)).map((property) => [
      property,
      readPropertyVisibility(appSettings, property),
    ]),
  );

// A present-but-unknown annotation is an authoring mistake, not a visibility choice.
// Reading it fails safe, but staying silent would leave the author believing a
// property is public while the core hides it. ADR-008 catches mislabels at
// registration; this is that principle applied to the settings channel.
export const assertVisibilityAnnotations = (appSettings: JsonSchemaObject): void => {
  for (const [property, rawDefinition] of Object.entries(propertiesOf(appSettings))) {
    const definition = asRecord(rawDefinition);
    if (definition === null) {
      continue;
    }

    const annotation = definition[VISIBILITY_ANNOTATION];
    if (annotation === undefined) {
      continue;
    }

    if (!visibilitySchema.safeParse(annotation).success) {
      throw new ContractError(
        'MANIFEST_INVALID',
        `appSettings property "${property}" declares an unknown ${VISIBILITY_ANNOTATION}: ${JSON.stringify(annotation)}`,
      );
    }
  }
};
