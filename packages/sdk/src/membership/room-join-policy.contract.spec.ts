import { ROOM_JOIN_POLICIES, roomJoinPolicySchema } from './room-join-policy';
import { validJoinPolicies, invalidJoinPolicies } from './room-join-policy.fixtures';

describe('roomJoinPolicy contract (REQ-ID-002)', () => {
  it('declares exactly the three policies of REQ-ID-002', () => {
    expect([...ROOM_JOIN_POLICIES]).toEqual(['guests', 'registered', 'invite_only']);
  });

  it.each(validJoinPolicies)('accepts %s', (policy) => {
    expect(roomJoinPolicySchema.safeParse(policy).success).toBe(true);
  });

  it.each(invalidJoinPolicies.map((v) => [String(v), v] as const))('rejects %s', (_name, v) => {
    expect(roomJoinPolicySchema.safeParse(v).success).toBe(false);
  });
});
