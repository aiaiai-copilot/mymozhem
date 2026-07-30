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
  // Transport-facing API errors (first HTTP slice, REQ-SEC-006).
  'ROOM_JOIN_DENIED',
  'ROOM_PARTICIPANT_LIMIT_REACHED',
  'RATE_LIMITED',
  'REQUEST_INVALID',
  'SESSION_INVALID',
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
