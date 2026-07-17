import { z } from 'zod';
import type { Visibility } from '../visibility/visibility';
import { CORE_NAMESPACE, appIdSchema, composeEventType } from './event-type';

// Shape shared by the core registry and the app registry in a manifest, so that the
// commit pipeline differs only in WHERE the registry comes from, not in its logic
// (design §4.2). `visibility` is the exposure ceiling of the type (REQ-CTR-009);
// `version` is what the core stamps as the event's schemaVersion.
export type EventTypeDefinition = {
  readonly schema: z.ZodType;
  readonly visibility: Visibility;
  readonly version: number;
};

// Core-owned event types. Static zod, with no conversion and no snapshot: the core
// is versioned by the contract rather than by a manifest, and these schemas never
// cross the boundary (design §4.2).
//
// The set is the lifecycle transitions of REQ-RT-005 (DRAFT → ACTIVE → COMPLETED,
// DRAFT → CANCELLED, ACTIVE → CANCELLED), emitted as public events per REQ-RT-010.
export const CORE_EVENTS = {
  'room.activated': {
    // ACTIVE freezes appSettings and the pair (appId, manifestVersion) — REQ-RT-004.
    // Carrying the pin keeps the log self-describing without a join to the room.
    schema: z.strictObject({
      appId: appIdSchema,
      manifestVersion: z.number().int().positive(),
    }),
    visibility: 'public',
    version: 1,
  },
  'room.completed': {
    schema: z.strictObject({}),
    visibility: 'public',
    version: 1,
  },
  'room.cancelled': {
    schema: z.strictObject({}),
    visibility: 'public',
    version: 1,
  },
} as const satisfies Record<string, EventTypeDefinition>;

export type CoreEventName = keyof typeof CORE_EVENTS;

export const coreEventType = (name: CoreEventName): string =>
  composeEventType(CORE_NAMESPACE, name);

export const isCoreEventName = (name: string): name is CoreEventName =>
  Object.prototype.hasOwnProperty.call(CORE_EVENTS, name);
