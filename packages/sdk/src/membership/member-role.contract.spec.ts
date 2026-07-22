import { MEMBER_ROLES, memberRoleSchema } from './member-role';
import { validRoles, invalidRoles } from './member-role.fixtures';

describe('memberRole contract (REQ-ID-011)', () => {
  it('declares exactly the four roles of REQ-ID-011', () => {
    expect([...MEMBER_ROLES]).toEqual(['ORGANIZER', 'MODERATOR', 'PARTICIPANT', 'SPECTATOR']);
  });

  it.each(validRoles)('accepts %s', (role) => {
    expect(memberRoleSchema.safeParse(role).success).toBe(true);
  });

  it.each(invalidRoles.map((v) => [String(v), v] as const))('rejects %s', (_name, v) => {
    expect(memberRoleSchema.safeParse(v).success).toBe(false);
  });
});
