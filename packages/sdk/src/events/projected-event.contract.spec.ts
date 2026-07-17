import { projectedEventSchema } from './projected-event.schema';
import {
  invalidProjectedEventCases,
  validProjectedEvents,
} from './projected-event.fixtures';

describe('projectedEvent contract', () => {
  it.each(validProjectedEvents.map((e, i) => [i, e] as const))(
    'accepts valid fixture #%i',
    (_i, event) => {
      expect(projectedEventSchema.safeParse(event).success).toBe(true);
    },
  );

  it.each(invalidProjectedEventCases.map((c) => [c.name, c.value] as const))(
    'rejects invalid fixture: %s',
    (_name, value) => {
      expect(projectedEventSchema.safeParse(value).success).toBe(false);
    },
  );

  // REQ-RT-011(a) per amendment v1.3: the global seq is never exposed to a
  // participant. It holds structurally — the field is not in the schema at all.
  it('has no seq, visibility or cursor field to expose', () => {
    const keys = Object.keys(projectedEventSchema.shape);
    expect(keys.sort()).toEqual(['actorId', 'payload', 'type']);
  });
});
