import type { IdentityKind } from './identity-kind';

export const validKinds: IdentityKind[] = ['REGISTERED', 'GUEST'];

// Unknown roles, wrong case, empty, non-strings — all rejected.
export const invalidKinds: unknown[] = ['ADMIN', 'guest', 'registered', '', null, 42];
