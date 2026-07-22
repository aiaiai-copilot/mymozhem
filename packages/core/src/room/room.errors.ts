// Core-internal typed domain errors for the Room lifecycle. NOT part of the SDK
// contract (these do not cross the app↔core boundary in this slice). When an HTTP
// surface for the organizer lands, these map to typed API responses without
// stack traces (REQ-SEC-006).
export const ROOM_ERROR_CODES = {
  ROOM_TRANSITION_INVALID: 'ROOM_TRANSITION_INVALID',
  ROOM_CONFLICT: 'ROOM_CONFLICT',
  ROOM_ORGANIZER_NOT_REGISTERED: 'ROOM_ORGANIZER_NOT_REGISTERED',
} as const;

export type RoomErrorCode = (typeof ROOM_ERROR_CODES)[keyof typeof ROOM_ERROR_CODES];

export class RoomError extends Error {
  constructor(
    readonly code: RoomErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

// State-machine violation: illegal transition, or soft-delete of an ACTIVE room.
export class RoomTransitionError extends RoomError {
  constructor(message: string) {
    super(ROOM_ERROR_CODES.ROOM_TRANSITION_INVALID, message);
  }
}

// Atomic conditional UPDATE affected zero rows: not-found, concurrent change,
// already terminal, or already deleted.
export class RoomConflictError extends RoomError {
  constructor(message: string) {
    super(ROOM_ERROR_CODES.ROOM_CONFLICT, message);
  }
}

// Organizer identity missing, GUEST, or anonymized — collapsed into one code on
// purpose (design §3): to the caller it is a single refusal, and the predicate is
// identity's invariant, not a place for reconnaissance.
export class RoomOrganizerNotRegisteredError extends RoomError {
  constructor(message: string) {
    super(ROOM_ERROR_CODES.ROOM_ORGANIZER_NOT_REGISTERED, message);
  }
}
