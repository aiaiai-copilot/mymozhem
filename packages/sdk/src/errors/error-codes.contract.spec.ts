import {
  CONTRACT_ERROR_CODES,
  ContractError,
  contractErrorCodeSchema,
  contractErrorPayloadSchema,
} from './error-codes';

describe('contract errors', () => {
  it('exports exactly the codes named by the design §8', () => {
    expect([...CONTRACT_ERROR_CODES]).toEqual([
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
      'ROOM_JOIN_DENIED',
      'ROOM_PARTICIPANT_LIMIT_REACHED',
      'RATE_LIMITED',
      'REQUEST_INVALID',
      'SESSION_INVALID',
      'INTERNAL_ERROR',
    ]);
  });

  it('rejects an unknown code', () => {
    expect(contractErrorCodeSchema.safeParse('KABOOM').success).toBe(false);
  });

  it('carries its code and stays a real Error', () => {
    const err = new ContractError('EVENT_UNKNOWN_TYPE', 'internal detail: table app_registry empty');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('EVENT_UNKNOWN_TYPE');
  });

  // REQ-SEC-006: outward there is a code and nothing else — no message, no stack.
  it('projects outward as a bare code, leaking neither message nor stack', () => {
    const err = new ContractError('EVENT_UNKNOWN_TYPE', 'internal detail: table app_registry empty');
    const payload = err.toPayload();

    expect(payload).toEqual({ code: 'EVENT_UNKNOWN_TYPE' });
    expect(contractErrorPayloadSchema.safeParse(payload).success).toBe(true);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('internal detail');
    expect(serialized).not.toContain('at ');
  });

  it('rejects an outward payload that smuggles extra fields', () => {
    const smuggled = { code: 'EVENT_UNKNOWN_TYPE', message: 'table app_registry empty' };
    expect(contractErrorPayloadSchema.safeParse(smuggled).success).toBe(false);
  });
});
