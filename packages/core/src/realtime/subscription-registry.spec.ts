import { SubscriptionRegistry } from './subscription-registry';

const SUB_A = { socketId: 's1', identityId: 'u1', roomId: 'r1', level: 'public' as const };
const SUB_B = { socketId: 's2', identityId: 'u1', roomId: 'r1', level: 'organizer' as const };
const SUB_C = { socketId: 's3', identityId: 'u2', roomId: 'r1', level: 'public' as const };

describe('SubscriptionRegistry', () => {
  it('add/get/remove round-trip', () => {
    const registry = new SubscriptionRegistry();
    registry.add(SUB_A);
    expect(registry.get('s1')).toEqual(SUB_A);
    registry.remove('s1');
    expect(registry.get('s1')).toBeUndefined();
  });

  it('socketsOf groups by (identityId, roomId) for the revoke hook', () => {
    const registry = new SubscriptionRegistry();
    registry.add(SUB_A);
    registry.add(SUB_B);
    registry.add(SUB_C);
    expect([...registry.socketsOf('u1', 'r1')].sort()).toEqual(['s1', 's2']);
    expect(registry.socketsOf('u2', 'r1')).toEqual(['s3']);
    expect(registry.socketsOf('u1', 'r2')).toEqual([]);
  });

  it('remove cleans the membership index; empty sets are dropped', () => {
    const registry = new SubscriptionRegistry();
    registry.add(SUB_A);
    registry.add(SUB_B);
    registry.remove('s1');
    expect(registry.socketsOf('u1', 'r1')).toEqual(['s2']);
    registry.remove('s2');
    expect(registry.socketsOf('u1', 'r1')).toEqual([]);
  });

  it('removing an unknown socket is a no-op', () => {
    const registry = new SubscriptionRegistry();
    expect(() => registry.remove('nope')).not.toThrow();
  });
});
