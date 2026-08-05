import type { ContractErrorCode } from '@mymozhem/sdk';
import { REALTIME_ERROR_CODES, RealtimeError, type RealtimeErrorCode } from './realtime.errors';

// Единственная точка перевода core→contract кодов event-commit (design §3).
// Core-имена (design event-commit §6, утверждены) НЕ переименовываются — перевод
// только здесь, на границе. EVENT_EMIT_RATE_LIMITED → EVENT_RATE_LIMITED (доменный
// лимит REQ-RT-014), НЕ RATE_LIMITED — тот остаётся транспортным (HTTP, handshake-
// потолок), решение владельца §0.4. Полнота принуждается компилятором: новый член
// REALTIME_ERROR_CODES ломает сборку, пока не добавлена строка маппинга.
const CONTRACT_CODE_BY_CORE_CODE = {
  [REALTIME_ERROR_CODES.ROOM_NOT_ACTIVE]: 'ROOM_LOG_SEALED',
  [REALTIME_ERROR_CODES.EVENT_EMIT_RATE_LIMITED]: 'EVENT_RATE_LIMITED',
  [REALTIME_ERROR_CODES.EVENT_PAYLOAD_TOO_LARGE]: 'EVENT_PAYLOAD_TOO_LARGE',
  [REALTIME_ERROR_CODES.EVENT_TYPE_UNKNOWN]: 'EVENT_UNKNOWN_TYPE',
  [REALTIME_ERROR_CODES.EVENT_PAYLOAD_INVALID]: 'EVENT_PAYLOAD_INVALID',
  [REALTIME_ERROR_CODES.EVENT_VISIBILITY_EXCEEDED]: 'EVENT_VISIBILITY_WEAKER_THAN_DECLARED',
  [REALTIME_ERROR_CODES.ACTOR_NOT_MEMBER]: 'ACTOR_NOT_MEMBER',
} as const satisfies Record<RealtimeErrorCode, ContractErrorCode>;

export const contractCodeFor = (error: RealtimeError): ContractErrorCode =>
  CONTRACT_CODE_BY_CORE_CODE[error.code];
