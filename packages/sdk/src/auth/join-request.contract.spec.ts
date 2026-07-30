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
});
