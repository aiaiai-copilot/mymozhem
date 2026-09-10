import { REWARDS_EVENTS, rewardsEventType } from './rewards-events';

describe('REWARDS_EVENTS (REQ-SEC-009: только id, без PII)', () => {
  it('declares the three public types of the award lifecycle', () => {
    expect(Object.keys(REWARDS_EVENTS).sort()).toEqual([
      'reward.awarded',
      'reward.fulfilled',
      'reward.revoked',
    ]);
    for (const def of Object.values(REWARDS_EVENTS)) {
      expect(def.visibility).toBe('public');
      expect(def.version).toBe(1);
    }
  });

  it('parses the reward.awarded payload (nullable prizeId — REQ-RWD-002b)', () => {
    const p = {
      awardId: '3f6b2b6e-9c5a-4f1e-8b2d-7a9c1e0f2a3b',
      prizeId: null,
      winnerId: '00000000-0000-4000-8000-000000000001',
      sourceAppId: 'lottery',
    };
    expect(REWARDS_EVENTS['reward.awarded'].schema.safeParse(p).success).toBe(true);
    expect(REWARDS_EVENTS['reward.awarded'].schema.safeParse({ ...p, displayName: 'Петя' }).success).toBe(false);
  });

  it('parses fulfill/revoke payloads', () => {
    const p = { awardId: '3f6b2b6e-9c5a-4f1e-8b2d-7a9c1e0f2a3b' };
    expect(REWARDS_EVENTS['reward.fulfilled'].schema.safeParse(p).success).toBe(true);
    expect(REWARDS_EVENTS['reward.revoked'].schema.safeParse(p).success).toBe(true);
    expect(REWARDS_EVENTS['reward.revoked'].schema.safeParse({}).success).toBe(false);
  });

  it('composes the wire type under the rewards namespace', () => {
    expect(rewardsEventType('reward.awarded')).toBe('rewards.reward.awarded');
  });
});
