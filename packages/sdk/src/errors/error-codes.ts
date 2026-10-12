import { z } from 'zod';

// Typed error codes crossing the contract boundary (REQ-SEC-006, design §8).
// The SDK exports them because a module is required to be able to parse them.
export const CONTRACT_ERROR_CODES = [
  'MANIFEST_INVALID',
  'CONTRACT_VERSION_INCOMPATIBLE',
  'SCHEMA_NOT_REPRESENTABLE',
  'EVENT_UNKNOWN_TYPE',
  'EVENT_PAYLOAD_INVALID',
  'EVENT_VISIBILITY_WEAKER_THAN_DECLARED',
  'EVENT_PAYLOAD_TOO_LARGE',
  'EVENT_RATE_LIMITED',
  'ROOM_LOG_SEALED',
  'ROOM_SETTINGS_FROZEN',
  // Организатор комнаты — только REGISTERED (REQ-ID-005; ADR-012: контур больше не OAuth).
  'ROOM_ORGANIZER_NOT_REGISTERED',
  'ACTOR_NOT_MEMBER',
  // ADR-012 (срез zero-PII): bootstrap организатора и призовой режим.
  'ORGANIZER_SETUP_INVALID',
  'PRIZES_DISABLED',
  // Membership exclusion (срез исключения, REQ-ID-006): отказы endpoint'а exclude.
  'ACTOR_NOT_ORGANIZER',
  'TARGET_NOT_MEMBER',
  'TARGET_NOT_EXCLUDABLE',
  // Transport-facing API errors (first HTTP slice, REQ-SEC-006).
  'ROOM_JOIN_DENIED',
  'ROOM_PARTICIPANT_LIMIT_REACHED',
  'RATE_LIMITED',
  'REQUEST_INVALID',
  'SESSION_INVALID',
  // Quiz-срез (фаза 2, design 2026-09-09): диспетчер app-runtime и отказы модуля.
  'MODULE_UNAVAILABLE',
  'PUBLISH_FORBIDDEN',
  'ANSWER_TOO_FAST',
  'ROUND_NOT_OPEN',
  'ALREADY_ANSWERED',
  'QUESTION_UNKNOWN',
  'OPTION_UNKNOWN',
  // Фаза 3 (design 2026-09-10): rewards/lottery + REST-контур фонда.
  'ROOM_NOT_ACTIVE',
  'CAPABILITY_UNAVAILABLE',
  'PRIZE_UNKNOWN',
  'PRIZE_FUND_EXHAUSTED',
  'DRAW_POOL_EMPTY',
  'AWARD_UNKNOWN',
  'REWARD_ALREADY_RESOLVED',
  // Фаза 4 (C-8.1): award по анонимизированной/неизвестной identity отклонён —
  // приз не должен осиротеть (дизайн 2026-09-24 §4).
  'IDENTITY_ANONYMIZED',
  'INTERNAL_ERROR',
] as const;

export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[number];
export const contractErrorCodeSchema = z.enum(CONTRACT_ERROR_CODES);

// The wire form of an error: a code, and deliberately nothing else. strictObject so
// that a well-meaning `message` field cannot be added without failing this contract
// (REQ-SEC-006 bans forwarding raw error.message outward).
export const contractErrorPayloadSchema = z.strictObject({
  code: contractErrorCodeSchema,
});
export type ContractErrorPayload = z.infer<typeof contractErrorPayloadSchema>;

export class ContractError extends Error {
  readonly code: ContractErrorCode;

  constructor(code: ContractErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ContractError';
  }

  // The message stays server-side, for logs and tests; only the code goes out.
  toPayload(): ContractErrorPayload {
    return { code: this.code };
  }
}
