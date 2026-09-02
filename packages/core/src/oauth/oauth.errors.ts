// Core-internal ошибки OAuth-флоу (REQ-ID-015/009). Коды совпадают с wire-кодами
// SDK (@mymozhem/sdk error-codes); маппинг в HTTP — дело exception-фильтра (Task 7).
export const OAUTH_ERROR_CODES = {
  OAUTH_NOT_CONFIGURED: 'OAUTH_NOT_CONFIGURED',
  OAUTH_REDIRECT_INVALID: 'OAUTH_REDIRECT_INVALID',
  OAUTH_STATE_INVALID: 'OAUTH_STATE_INVALID',
  OAUTH_ACCESS_DENIED: 'OAUTH_ACCESS_DENIED',
  OAUTH_EXCHANGE_FAILED: 'OAUTH_EXCHANGE_FAILED',
  OAUTH_EMAIL_UNVERIFIED: 'OAUTH_EMAIL_UNVERIFIED',
  OAUTH_EMAIL_CONFLICT: 'OAUTH_EMAIL_CONFLICT',
} as const;
export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[keyof typeof OAUTH_ERROR_CODES];

export class OAuthError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
