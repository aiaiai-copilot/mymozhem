import type { MemberRole } from './member-role';

export const validRoles: MemberRole[] = ['ORGANIZER', 'MODERATOR', 'PARTICIPANT', 'SPECTATOR'];

// Unknown roles, wrong case, empty, non-strings — all rejected.
export const invalidRoles: unknown[] = ['ADMIN', 'organizer', 'owner', '', null, 42];
