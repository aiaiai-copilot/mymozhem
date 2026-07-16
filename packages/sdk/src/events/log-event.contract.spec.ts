import { logEventSchema } from './log-event.schema';
import { validLogEvents, invalidLogEventCases } from './log-event.fixtures';

describe('logEvent contract', () => {
  it.each(validLogEvents.map((e, i) => [i, e] as const))(
    'accepts valid fixture #%i',
    (_i, event) => {
      const result = logEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    },
  );

  it.each(invalidLogEventCases.map((c) => [c.name, c.value] as const))(
    'rejects invalid fixture: %s',
    (_name, value) => {
      const result = logEventSchema.safeParse(value);
      expect(result.success).toBe(false);
    },
  );

  it('rejects a visibility level weaker than the declared enum', () => {
    const bad = { ...validLogEvents[0], visibility: 'secret' };
    expect(logEventSchema.safeParse(bad).success).toBe(false);
  });
});
