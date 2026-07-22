import type { IdentityKind } from './identity-kind';

export const validKinds: IdentityKind[] = ['REGISTERED', 'GUEST'];

// Unknown kinds, wrong case, empty, non-strings — all rejected.
export const invalidKinds: unknown[] = ['ADMIN', 'guest', 'registered', '', null, 42];
