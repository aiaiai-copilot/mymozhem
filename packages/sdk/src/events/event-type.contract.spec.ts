import {
  CORE_NAMESPACE,
  appIdSchema,
  composeEventType,
  eventTypeSchema,
  resolveTypeOwner,
  shortEventNameSchema,
} from './event-type';
import { ContractError } from '../errors/error-codes';

describe('event type ownership', () => {
  it.each(['core.room.activated', 'quiz.answer_scored', 'quiz.answer.submitted'])(
    'accepts a namespaced type: %s',
    (type) => {
      expect(eventTypeSchema.safeParse(type).success).toBe(true);
    },
  );

  it.each(['nodot', 'core.', '.leading', 'Quiz.Answer', 'quiz..double'])(
    'rejects a malformed type: %s',
    (type) => {
      expect(eventTypeSchema.safeParse(type).success).toBe(false);
    },
  );

  it('resolves the core namespace to the core', () => {
    expect(resolveTypeOwner('core.room.activated')).toEqual({
      kind: 'core',
      shortName: 'room.activated',
    });
  });

  it('resolves any other namespace to the app that owns it', () => {
    expect(resolveTypeOwner('quiz.answer.submitted')).toEqual({
      kind: 'app',
      appId: 'quiz',
      shortName: 'answer.submitted',
    });
  });

  it('rejects an unresolvable type with a typed error', () => {
    expect(() => resolveTypeOwner('nodot')).toThrow(ContractError);
    try {
      resolveTypeOwner('nodot');
    } catch (err) {
      expect((err as ContractError).code).toBe('EVENT_UNKNOWN_TYPE');
    }
  });

  // §4.1: an app declares SHORT names; the core prefixes the namespace itself.
  // Forging a foreign namespace must be inexpressible, not merely forbidden.
  it('gives an app no way to declare into the core namespace', () => {
    expect(shortEventNameSchema.safeParse('room.activated').success).toBe(true);
    expect(composeEventType('quiz', 'room.activated')).toBe('quiz.room.activated');
    expect(resolveTypeOwner(composeEventType('quiz', 'room.activated')).kind).toBe('app');
  });

  it('reserves the core namespace against an app claiming it as its appId', () => {
    expect(appIdSchema.safeParse(CORE_NAMESPACE).success).toBe(false);
    expect(appIdSchema.safeParse('quiz').success).toBe(true);
  });

  // The regexes for appIdSchema, shortEventNameSchema and eventTypeSchema are built from
  // shared segments (event-type.ts) precisely so this holds by construction, not by three
  // regexes coincidentally agreeing. This test exercises the composition itself, not fixed
  // example strings, so a future edit to one character class that breaks the other two
  // would fail here even if it happened to still pass every fixed-string assertion above.
  describe('composition invariant: an accepted appId + an accepted short name always compose into an accepted, round-trippable event type', () => {
    const appIds = ['quiz', 'app-2', 'a'];
    const shortNames = ['answer_scored', 'answer.submitted', 'started'];

    const cases = appIds.flatMap((appId) =>
      shortNames.map((shortName) => [appId, shortName] as const),
    );

    it.each(cases)('appId=%s, shortName=%s', (appId, shortName) => {
      expect(appIdSchema.safeParse(appId).success).toBe(true);
      expect(shortEventNameSchema.safeParse(shortName).success).toBe(true);

      const type = composeEventType(appId, shortName);
      expect(eventTypeSchema.safeParse(type).success).toBe(true);
      expect(resolveTypeOwner(type)).toEqual({ kind: 'app', appId, shortName });
    });
  });
});
