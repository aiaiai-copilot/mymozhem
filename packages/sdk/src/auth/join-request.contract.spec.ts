import { joinRequestSchema } from './join-request';
import { validJoinRequests, invalidJoinRequests } from './join-request.fixtures';

describe('joinRequest contract (REQ-ID-003)', () => {
  it.each(validJoinRequests.map((v) => [JSON.stringify(v), v] as const))('accepts %s', (_l, v) => {
    expect(joinRequestSchema.safeParse(v).success).toBe(true);
  });
  it.each(invalidJoinRequests.map((v) => [JSON.stringify(v), v] as const))('rejects %s', (_l, v) => {
    expect(joinRequestSchema.safeParse(v).success).toBe(false);
  });
  it('trims displayName via the shared displayNameSchema', () => {
    expect(joinRequestSchema.parse({ code: 'ABCDEFGH', displayName: '  Alex  ' }).displayName).toBe('Alex');
  });

  it('accepts explicit spectator role', () => {
    expect(joinRequestSchema.safeParse({ code: 'ABCDEFGH', displayName: 'Гляделкин', role: 'spectator' }).success).toBe(true);
  });

  it('defaults to participant semantics: role is optional', () => {
    const parsed = joinRequestSchema.safeParse({ code: 'ABCDEFGH', displayName: 'Игрок' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.role).toBeUndefined();
  });

  it('refuses privileged roles through the join flag', () => {
    for (const role of ['organizer', 'moderator', 'ORGANIZER', 'SPECTATOR']) {
      expect(joinRequestSchema.safeParse({ code: 'ABCDEFGH', displayName: 'x', role }).success).toBe(false);
    }
  });
});
