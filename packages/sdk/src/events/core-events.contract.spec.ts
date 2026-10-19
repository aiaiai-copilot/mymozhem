import { CORE_EVENTS, coreEventType, isCoreEventName } from './core-events';
import { resolveTypeOwner } from './event-type';

describe('core event registry', () => {
  it('registers exactly the lifecycle transitions of REQ-RT-005', () => {
    expect(Object.keys(CORE_EVENTS).sort()).toEqual([
      'member.joined',
      'room.activated',
      'room.cancelled',
      'room.completed',
    ]);
  });

  // REQ-RT-010: lifecycle transitions are emitted as public events.
  it.each(Object.keys(CORE_EVENTS))('declares %s public (REQ-RT-010)', (name) => {
    expect(CORE_EVENTS[name as keyof typeof CORE_EVENTS].visibility).toBe('public');
  });

  it('composes full types inside the core namespace, owned by the core', () => {
    expect(coreEventType('room.activated')).toBe('core.room.activated');
    expect(resolveTypeOwner(coreEventType('room.activated'))).toEqual({
      kind: 'core',
      shortName: 'room.activated',
    });
  });

  it('recognises its own short names and nothing else', () => {
    expect(isCoreEventName('room.activated')).toBe(true);
    expect(isCoreEventName('answer.submitted')).toBe(false);
  });

  // REQ-RT-004: ACTIVE freezes the pin, so the activation event carries it.
  it('validates the activation payload as the pin (appId, manifestVersion)', () => {
    const schema = CORE_EVENTS['room.activated'].schema;
    expect(schema.safeParse({ appId: 'quiz', manifestVersion: 1 }).success).toBe(true);
    expect(schema.safeParse({ appId: 'quiz' }).success).toBe(false);
    expect(schema.safeParse({ appId: 'core', manifestVersion: 1 }).success).toBe(false);
    expect(schema.safeParse({ appId: 'quiz', manifestVersion: 0 }).success).toBe(false);
  });

  it('rejects payload on the terminal transitions', () => {
    expect(CORE_EVENTS['room.completed'].schema.safeParse({}).success).toBe(true);
    expect(CORE_EVENTS['room.completed'].schema.safeParse({ reason: 'x' }).success).toBe(false);
  });

  // member.joined announces a membership becoming visible on the roster; the payload
  // is exactly the joining identity, nothing more (strict object).
  it('validates the member.joined payload as the joining identity', () => {
    const def = CORE_EVENTS['member.joined'];
    const schema = def.schema;
    expect(def.visibility).toBe('public');
    expect(def.version).toBe(1);
    expect(
      schema.safeParse({ identityId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }).success,
    ).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(
      schema.safeParse({
        identityId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        displayName: 'x',
      }).success,
    ).toBe(false);
    expect(schema.safeParse({ identityId: 'not-a-uuid' }).success).toBe(false);
  });

  it('declares a positive schemaVersion for every type', () => {
    for (const def of Object.values(CORE_EVENTS)) {
      expect(def.version).toBeGreaterThan(0);
    }
  });
});
