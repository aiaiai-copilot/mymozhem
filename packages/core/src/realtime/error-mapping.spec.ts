import { contractErrorCodeSchema, type ContractErrorCode } from '@mymozhem/sdk';
import { contractCodeFor } from './error-mapping';
import { REALTIME_ERROR_CODES, RealtimeError } from './realtime.errors';

// Таблица — решение владельца 2026-08-05 (design §3, §0.4/§0.5): core-имена не
// переименовываются, перевод только здесь.
const EXPECTED: Record<string, ContractErrorCode> = {
  [REALTIME_ERROR_CODES.ROOM_NOT_ACTIVE]: 'ROOM_LOG_SEALED',
  [REALTIME_ERROR_CODES.EVENT_EMIT_RATE_LIMITED]: 'EVENT_RATE_LIMITED',
  [REALTIME_ERROR_CODES.EVENT_PAYLOAD_TOO_LARGE]: 'EVENT_PAYLOAD_TOO_LARGE',
  [REALTIME_ERROR_CODES.EVENT_TYPE_UNKNOWN]: 'EVENT_UNKNOWN_TYPE',
  [REALTIME_ERROR_CODES.EVENT_PAYLOAD_INVALID]: 'EVENT_PAYLOAD_INVALID',
  [REALTIME_ERROR_CODES.EVENT_VISIBILITY_EXCEEDED]: 'EVENT_VISIBILITY_WEAKER_THAN_DECLARED',
  [REALTIME_ERROR_CODES.ACTOR_NOT_MEMBER]: 'ACTOR_NOT_MEMBER',
};

describe('contractCodeFor', () => {
  it.each(Object.entries(EXPECTED))('maps %s → %s', (coreCode, contractCode) => {
    expect(contractCodeFor(new RealtimeError(coreCode as never, 'm'))).toBe(contractCode);
  });

  it('covers every core code exactly once', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.values(REALTIME_ERROR_CODES).sort());
  });

  it.each(Object.values(EXPECTED))('target %s is a valid contract code', (code) => {
    expect(contractErrorCodeSchema.safeParse(code).success).toBe(true);
  });
});
