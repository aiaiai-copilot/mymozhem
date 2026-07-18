import {
  canTransition,
  assertTransition,
  isDeletable,
  assertDeletable,
  type RoomStatus,
} from './room-state-machine';
import { RoomTransitionError } from './room.errors';

const ALL_STATUSES: readonly RoomStatus[] = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

// Restated independently from REQ-RT-005 — deliberately NOT imported from the
// production table, which would make every assertion below tautological.
const LEGAL: Array<[RoomStatus, RoomStatus]> = [
  ['DRAFT', 'ACTIVE'],
  ['DRAFT', 'CANCELLED'],
  ['ACTIVE', 'COMPLETED'],
  ['ACTIVE', 'CANCELLED'],
];

const isLegal = (from: RoomStatus, to: RoomStatus): boolean =>
  LEGAL.some(([f, t]) => f === from && t === to);

// Derived as the complement of LEGAL over the full 4x4 product rather than hand-listed,
// so the suite also proves the allow-list holds nothing EXTRA — terminal-state escapes
// and self-transitions included.
const ILLEGAL: Array<[RoomStatus, RoomStatus]> = ALL_STATUSES.flatMap((from) =>
  ALL_STATUSES.filter((to) => !isLegal(from, to)).map(
    (to): [RoomStatus, RoomStatus] => [from, to],
  ),
);

describe('room-state-machine transitions', () => {
  it('covers the whole 4x4 product between LEGAL and ILLEGAL', () => {
    expect(LEGAL.length + ILLEGAL.length).toBe(ALL_STATUSES.length ** 2);
  });

  it.each(LEGAL)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each(ILLEGAL)('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(RoomTransitionError);
  });

  it('throws with code ROOM_TRANSITION_INVALID', () => {
    expect(() => assertTransition('DRAFT', 'COMPLETED')).toThrow(
      expect.objectContaining({ code: 'ROOM_TRANSITION_INVALID' }),
    );
  });

  it('degrades to false/typed-error instead of throwing for an out-of-domain status', () => {
    // Simulates a Prisma enum value that has drifted out of sync with RoomStatus at
    // runtime — the scenario room.service.ts's compile-time parity assertion guards
    // against. Without a total lookup, ROOM_TRANSITIONS[from] would be undefined and
    // `.has(to)` would throw an untyped TypeError instead of a typed domain error.
    const drifted = 'ARCHIVED' as unknown as RoomStatus;
    expect(canTransition(drifted, 'DRAFT')).toBe(false);
    expect(() => assertTransition(drifted, 'DRAFT')).toThrow(RoomTransitionError);
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
    expect(() => assertDeletable('ACTIVE')).toThrow(
      expect.objectContaining({ code: 'ROOM_TRANSITION_INVALID' }),
    );
  });

  it.each<[RoomStatus]>([['DRAFT'], ['COMPLETED'], ['CANCELLED']])(
    'assertDeletable permits %s',
    (status) => {
      expect(() => assertDeletable(status)).not.toThrow();
    },
  );
});
