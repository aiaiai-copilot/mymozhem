import { z } from 'zod';

// REQ-ID-011: membership role model. MODERATOR holds no privileges beyond
// PARTICIPANT until phase 4 (amendment v1.3) but stays in the enumeration;
// the access matrix lands with the membership entity.
export const MEMBER_ROLES = ['ORGANIZER', 'MODERATOR', 'PARTICIPANT', 'SPECTATOR'] as const;
export const memberRoleSchema = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof memberRoleSchema>;
