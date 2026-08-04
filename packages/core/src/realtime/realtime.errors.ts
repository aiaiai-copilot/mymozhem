// Core-internal typed errors of the event-commit chain (design §6). Не часть
// SDK-контракта: wire-маппинг придёт с realtime-транспортом (EVENT_EMIT_RATE_LIMITED
// → единый RATE_LIMITED по конвенции transport-среза).
export const REALTIME_ERROR_CODES = {
  ROOM_NOT_ACTIVE: 'ROOM_NOT_ACTIVE',
  EVENT_EMIT_RATE_LIMITED: 'EVENT_EMIT_RATE_LIMITED',
  EVENT_PAYLOAD_TOO_LARGE: 'EVENT_PAYLOAD_TOO_LARGE',
  EVENT_TYPE_UNKNOWN: 'EVENT_TYPE_UNKNOWN',
  // Строковый паритет с кодом ContractError SDK (commitCoreEvent): будущий транспорт
  // отобразит code→code 1:1.
  EVENT_PAYLOAD_INVALID: 'EVENT_PAYLOAD_INVALID',
  EVENT_VISIBILITY_EXCEEDED: 'EVENT_VISIBILITY_EXCEEDED',
  ACTOR_NOT_MEMBER: 'ACTOR_NOT_MEMBER',
} as const;

export type RealtimeErrorCode = (typeof REALTIME_ERROR_CODES)[keyof typeof REALTIME_ERROR_CODES];

export class RealtimeError extends Error {
  constructor(
    readonly code: RealtimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

// Эмит не в ACTIVE: DRAFT, терминальная (запечатывание REQ-RT-016), удалённая или
// отсутствующая комната — причины свёрнуты в один код (точность — в message).
export class RoomNotActiveError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.ROOM_NOT_ACTIVE, message);
  }
}

// REQ-RT-014: превышен per-actor хард rate-limit эмиссии — отказ, не алерт.
export class EventEmitRateLimitedError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.EVENT_EMIT_RATE_LIMITED, message);
  }
}

// REQ-RT-012: payload больше max_event_payload.
export class EventPayloadTooLargeError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.EVENT_PAYLOAD_TOO_LARGE, message);
  }
}

// REQ-CTR-008: тип события отсутствует в пиннутом манифесте.
export class EventTypeUnknownError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.EVENT_TYPE_UNKNOWN, message);
  }
}

// REQ-CTR-008: payload не соответствует зарегистрированной схеме владельца типа.
export class EventPayloadInvalidError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.EVENT_PAYLOAD_INVALID, message);
  }
}

// REQ-CTR-009: фактическая видимость слабее декларированного для типа потолка.
export class EventVisibilityExceededError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.EVENT_VISIBILITY_EXCEEDED, message);
  }
}

// Membership-гейт (design §0): actorId не член комнаты.
export class ActorNotMemberError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.ACTOR_NOT_MEMBER, message);
  }
}
