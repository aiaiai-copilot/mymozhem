import { z } from 'zod';
import { validRange } from 'semver';
import { visibilitySchema } from '../visibility/visibility';
import { appIdSchema, shortEventNameSchema } from '../events/event-type';

// A serialized JSON Schema as carried inside the manifest. ADR-006: the settings and
// event-type schemas of a given app "переносятся как сериализуемая JSON Schema
// внутри манифеста". Deliberately structural rather than a full JSON Schema
// meta-schema: authoring correctness is guaranteed upstream by defineApp, which is
// the only sanctioned way to produce one.
export const jsonSchemaObjectSchema = z.record(z.string(), z.unknown());
export type JsonSchemaObject = z.infer<typeof jsonSchemaObjectSchema>;

// NB for a future reader: .refine() is legal HERE. The guard in define-app.ts bans
// refinements only in APP-AUTHORED schemas, because those get converted to JSON
// Schema and the refinement would vanish silently. This schema is core-owned zod and
// is never converted — there is nothing to lose. Do not "fix" this.
export const contractRangeSchema = z
  .string()
  .refine((range) => validRange(range) !== null, { message: 'not a valid semver range' });

// Per-type exposure ceiling is mandatory (REQ-CTR-009, ADR-008 §2).
export const manifestEventSchema = z.strictObject({
  schema: jsonSchemaObjectSchema,
  visibility: visibilitySchema,
});

// The manifest (design §5). strictObject: an unknown field is refused rather than
// ignored — notably `capabilities`, which ADR-003 will introduce for rewards in
// phase 3 and which must not appear as empty scaffolding now (CLAUDE.md §2.3).
export const appManifestSchema = z.strictObject({
  appId: appIdSchema,
  manifestVersion: z.number().int().positive(),
  contractRange: contractRangeSchema,
  appSettings: jsonSchemaObjectSchema,
  events: z.record(shortEventNameSchema, manifestEventSchema),
});
export type AppManifest = z.infer<typeof appManifestSchema>;
