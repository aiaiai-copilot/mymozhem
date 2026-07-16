import { z } from 'zod';
import { ContractError } from '../errors/error-codes';

// The namespace owned by the core (design §4.1).
export const CORE_NAMESPACE = 'core';

// appId is a slug and, at the same time, the app's event namespace (design §5).
// `core` is refused so that an app cannot obtain the core namespace by naming itself.
export const appIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'appId must be a lowercase slug')
  .refine((id) => id !== CORE_NAMESPACE, { message: 'appId "core" is reserved' });
export type AppId = z.infer<typeof appIdSchema>;

// A short name as declared in a registry. Dots are allowed (`answer.submitted`):
// they cannot forge a namespace, because the owner prefix is prepended
// unconditionally by composeEventType.
export const shortEventNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/, 'short event name must be a dotted lowercase path');

// A fully-qualified event type: `<namespace>.<short name>`.
export const eventTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/, 'event type must be namespaced');

export const composeEventType = (namespace: string, shortName: string): string =>
  `${namespace}.${shortName}`;

export type TypeOwner =
  | { kind: 'core'; shortName: string }
  | { kind: 'app'; appId: AppId; shortName: string };

// Ownership is resolved by parsing the name — no lookup table that could drift out
// of sync with the registry (design §4.1).
export const resolveTypeOwner = (type: string): TypeOwner => {
  if (!eventTypeSchema.safeParse(type).success) {
    throw new ContractError('EVENT_UNKNOWN_TYPE', `event type "${type}" is not namespaced`);
  }

  const separator = type.indexOf('.');
  const namespace = type.slice(0, separator);
  const shortName = type.slice(separator + 1);

  if (namespace === CORE_NAMESPACE) {
    return { kind: 'core', shortName };
  }

  const appId = appIdSchema.safeParse(namespace);
  if (!appId.success) {
    throw new ContractError('EVENT_UNKNOWN_TYPE', `event type "${type}" has no resolvable owner`);
  }

  return { kind: 'app', appId: appId.data, shortName };
};
