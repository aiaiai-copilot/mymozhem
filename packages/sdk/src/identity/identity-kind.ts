import { z } from 'zod';

// REQ-ID-001: single identity table, kind REGISTERED | GUEST. Contract vocabulary,
// fixed here so membership, JWT claims and draw_eligibility don't fork literals
// before their slices land.
export const IDENTITY_KINDS = ['REGISTERED', 'GUEST'] as const;
export const identityKindSchema = z.enum(IDENTITY_KINDS);
export type IdentityKind = z.infer<typeof identityKindSchema>;
