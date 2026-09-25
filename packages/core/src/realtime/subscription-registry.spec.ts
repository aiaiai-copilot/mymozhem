import type { MetricsService } from '../observability/metrics.service';
import { SubscriptionRegistry } from './subscription-registry';

const makeMetrics = () =>
  ({
    connectionAdded: jest.fn(),
    connectionRemoved: jest.fn(),
  }) as unknown as MetricsService;

const SUB_A = { socketId: 's1', identityId: 'u1', roomId: 'r1', level: 'public' as const };
const SUB_B = { socketId: 's2', identityId: 'u1', roomId: 'r1', level: 'organizer' as const };
const SUB_C = { socketId: 's3', identityId: 'u2', roomId: 'r1', level: 'public' as const };

describe('SubscriptionRegistry', () => {
  it('add/get/remove round-trip', () => {
    const registry = new SubscriptionRegistry(makeMetrics());
    registry.add(SUB_A);
    expect(registry.get('s1')).toEqual(SUB_A);
    registry.remove('s1');
    expect(registry.get('s1')).toBeUndefined();
  });

  it('socketsOf groups by (identityId, roomId) for the revoke hook', () => {
    const registry = new SubscriptionRegistry(makeMetrics());
    registry.add(SUB_A);
    registry.add(SUB_B);
    registry.add(SUB_C);
    expect([...registry.socketsOf('u1', 'r1')].sort()).toEqual(['s1', 's2']);
    expect(registry.socketsOf('u2', 'r1')).toEqual(['s3']);
    expect(registry.socketsOf('u1', 'r2')).toEqual([]);
  });

  it('remove cleans the membership index; empty sets are dropped', () => {
    const registry = new SubscriptionRegistry(makeMetrics());
    registry.add(SUB_A);
    registry.add(SUB_B);
    registry.remove('s1');
    expect(registry.socketsOf('u1', 'r1')).toEqual(['s2']);
    registry.remove('s2');
    expect(registry.socketsOf('u1', 'r1')).toEqual([]);
  });

  it('removing an unknown socket is a no-op', () => {
    const registry = new SubscriptionRegistry(makeMetrics());
    expect(() => registry.remove('nope')).not.toThrow();
  });

  it('gauge: add инкрементирует, remove декрементирует, remove несуществующего — no-op (Review Focus 1)', () => {
    const metrics = makeMetrics();
    const registry = new SubscriptionRegistry(metrics);
    registry.add({ socketId: 's1', identityId: 'i1', roomId: 'r1', level: 'public' });
    expect(metrics.connectionAdded).toHaveBeenCalledWith('r1');
    registry.remove('s1');
    expect(metrics.connectionRemoved).toHaveBeenCalledWith('r1');
    registry.remove('s1'); // повтор — без декремента
    expect((metrics.connectionRemoved as jest.Mock).mock.calls).toHaveLength(1);
  });
});
