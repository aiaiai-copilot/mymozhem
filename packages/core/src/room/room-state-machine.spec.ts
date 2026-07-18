import {
  canTransition,
  assertTransition,
  isDeletable,
  assertDeletable,
  type RoomStatus,
} from './room-state-machine';
import { RoomTransitionError } from './room.errors';

const LEGAL: Array<[RoomStatus, RoomStatus]> = [
  ['DRAFT', 'ACTIVE'],
  ['DRAFT', 'CANCELLED'],
  ['ACTIVE', 'COMPLETED'],
  ['ACTIVE', 'CANCELLED'],
];

const ILLEGAL: Array<[RoomStatus, RoomStatus]> = [
  ['DRAFT', 'COMPLETED'],
  ['ACTIVE', 'DRAFT'],
  ['COMPLETED', 'ACTIVE'],
  ['COMPLETED', 'CANCELLED'],
  ['CANCELLED', 'ACTIVE'],
  ['DRAFT', 'DRAFT'],
  ['ACTIVE', 'ACTIVE'],
];

describe('room-state-machine transitions', () => {
  it.each(LEGAL)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each(ILLEGAL)('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(RoomTransitionError);
  });

  it('throws with code ROOM_TRANSITION_INVALID', () => {
    try {
      assertTransition('DRAFT', 'COMPLETED');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as RoomTransitionError).code).toBe('ROOM_TRANSITION_INVALID');
    }
  });
});

describe('room-state-machine deletability', () => {
  it.each<[RoomStatus, boolean]>([
    ['DRAFT', true],
    ['COMPLETED', true],
    ['CANCELLED', true],
    ['ACTIVE', false],
  ])('isDeletable(%s) === %s', (status, expected) => {
    expect(isDeletable(status)).toBe(expected);
  });

  it('assertDeletable rejects ACTIVE with ROOM_TRANSITION_INVALID', () => {
    expect(() => assertDeletable('ACTIVE')).toThrow(RoomTransitionError);
    expect(() => assertDeletable('DRAFT')).not.toThrow();
  });
});
