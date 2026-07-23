// Core-internal typed domain errors for the Room lifecycle. NOT part of the SDK
// contract (these do not cross the app↔core boundary in this slice). When an HTTP
// surface for the organizer lands, these map to typed API responses without
// stack traces (REQ-SEC-006).
export const ROOM_ERROR_CODES = {
  ROOM_TRANSITION_INVALID: 'ROOM_TRANSITION_INVALID',
  ROOM_CONFLICT: 'ROOM_CONFLICT',
  ROOM_ORGANIZER_NOT_REGISTERED: 'ROOM_ORGANIZER_NOT_REGISTERED',
  ROOM_NOT_CONFIGURED: 'ROOM_NOT_CONFIGURED',
  // Строковый паритет с зарезервированным кодом SDK-контракта (CONTRACT_ERROR_CODES,
  // design §6): будущий транспорт отобразит code→code 1:1. SDK не меняется.
  ROOM_SETTINGS_FROZEN: 'ROOM_SETTINGS_FROZEN',
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

// Активация требует сконфигурированной комнаты (REQ-RT-004): payload room.activated —
// пин (appId, manifestVersion), у неконфигурированной комнаты ему неоткуда взяться.
export class RoomNotConfiguredError extends RoomError {
  constructor(message: string) {
    super(ROOM_ERROR_CODES.ROOM_NOT_CONFIGURED, message);
  }
}

// Запись конфигурации закрыта: комната не DRAFT (заморозка REQ-RT-004), удалена или
// отсутствует. Причины свёрнуты в один код намеренно (design §6) — вызывающему единый
// отказ; точность — в server-side message.
export class RoomSettingsFrozenError extends RoomError {
  constructor(message: string) {
    super(ROOM_ERROR_CODES.ROOM_SETTINGS_FROZEN, message);
  }
}
