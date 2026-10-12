import { ContractError } from '@mymozhem/sdk';

// Типизированные отказы контура rewards (design 2026-09-10 §3). Wire-маппинг —
// HttpExceptionFilter (Task 6); над socket — ack с {code} (REQ-SEC-006).
export class PrizeUnknownError extends ContractError {
  constructor(prizeId: string) {
    super('PRIZE_UNKNOWN', `no prize ${prizeId} in this room`);
  }
}

export class PrizeFundExhaustedError extends ContractError {
  constructor(prizeId: string) {
    super('PRIZE_FUND_EXHAUSTED', `prize fund of ${prizeId} is exhausted`);
  }
}

export class AwardUnknownError extends ContractError {
  constructor(awardId: string) {
    super('AWARD_UNKNOWN', `no award ${awardId} in this room`);
  }
}

export class RewardAlreadyResolvedError extends ContractError {
  constructor(awardId: string, status: string) {
    super('REWARD_ALREADY_RESOLVED', `award ${awardId} is already ${status}`);
  }
}

// C-8.1 (ф.4): награждение анонимизированной (свип) или неизвестной identity
// отклонено — приз осиротел бы (displayName уже NULL, вручать некому).
export class IdentityAnonymizedError extends ContractError {
  constructor(identityId: string) {
    super('IDENTITY_ANONYMIZED', `identity ${identityId} is anonymized or unknown — prize would be orphaned`);
  }
}

// ADR-012 §4: призовой режим выключен конфигурацией (дефолт). Не гейтятся:
// fulfill/revoke/list — урегулирование существующих awards (REQ-RWD-009).
export class PrizesDisabledError extends ContractError {
  constructor() {
    super('PRIZES_DISABLED', 'prize mode is off (ADR-012)');
  }
}
