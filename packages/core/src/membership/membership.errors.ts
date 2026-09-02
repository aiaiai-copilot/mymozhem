// Core-internal typed domain errors for membership. NOT part of the SDK contract.
// The first transport maps them to typed responses without stack traces (REQ-SEC-006).
export const MEMBERSHIP_ERROR_CODES = {
  ROOM_JOIN_DENIED: 'ROOM_JOIN_DENIED',
  JOIN_RATE_LIMITED: 'JOIN_RATE_LIMITED',
  ROOM_PARTICIPANT_LIMIT_REACHED: 'ROOM_PARTICIPANT_LIMIT_REACHED',
  ACTOR_NOT_MEMBER: 'ACTOR_NOT_MEMBER',
  ACTOR_NOT_ORGANIZER: 'ACTOR_NOT_ORGANIZER',
  TARGET_NOT_MEMBER: 'TARGET_NOT_MEMBER',
  TARGET_NOT_EXCLUDABLE: 'TARGET_NOT_EXCLUDABLE',
} as const;

export type MembershipErrorCode =
  (typeof MEMBERSHIP_ERROR_CODES)[keyof typeof MEMBERSHIP_ERROR_CODES];

export class MembershipError extends Error {
  constructor(
    readonly code: MembershipErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

// Единообразный отказ входа (REQ-ID-013): ветки «неверный код», «комната удалена»,
// «терминальный статус», «закрытая политика» свёрнуты в один код — до установления
// членства ответ не раскрывает ни существование комнаты, ни её политику, ни статус
// (design §3). Server-side message может быть точным — наружу он не уходит.
export class RoomJoinDeniedError extends MembershipError {
  constructor(message: string) {
    super(MEMBERSHIP_ERROR_CODES.ROOM_JOIN_DENIED, message);
  }
}

// Превышен per-IP лимит попыток входа (REQ-ID-006). Отдельный код: он про IP, не про
// комнату — существование комнаты не раскрывает (design §3).
export class JoinRateLimitedError extends MembershipError {
  constructor(message: string) {
    super(MEMBERSHIP_ERROR_CODES.JOIN_RATE_LIMITED, message);
  }
}

// Комната заполнена (REQ-ID-006, room_participant_limit). Отдельный код — решение
// владельца (design §1, развилка (а)): «комната заполнена» actionable для организатора.
export class RoomParticipantLimitReachedError extends MembershipError {
  constructor(message: string) {
    super(MEMBERSHIP_ERROR_CODES.ROOM_PARTICIPANT_LIMIT_REACHED, message);
  }
}

// Срез исключения (REQ-ID-006). Имена кодов совпадают с wire-кодами SDK —
// HttpExceptionFilter отдаёт MembershipError.code наружу как есть (REQ-SEC-006:
// message остаётся серверным).
export class ActorNotMemberError extends MembershipError {
  constructor(message: string) {
    super(MEMBERSHIP_ERROR_CODES.ACTOR_NOT_MEMBER, message);
  }
}

export class ActorNotOrganizerError extends MembershipError {
  constructor(message: string) {
    super(MEMBERSHIP_ERROR_CODES.ACTOR_NOT_ORGANIZER, message);
  }
}

export class TargetNotMemberError extends MembershipError {
  constructor(message: string) {
    super(MEMBERSHIP_ERROR_CODES.TARGET_NOT_MEMBER, message);
  }
}

export class TargetNotExcludableError extends MembershipError {
  constructor(message: string) {
    super(MEMBERSHIP_ERROR_CODES.TARGET_NOT_EXCLUDABLE, message);
  }
}
