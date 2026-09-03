// Core-internal ошибки identity-потоков (REQ-ID-015 provisioning). Wire-маппинг —
// через вызывающий сервис (OAuthService, design §4/§7), а не напрямую в фильтр.
export const IDENTITY_ERROR_CODES = {
  EMAIL_CONFLICT: 'EMAIL_CONFLICT',
  PROVIDER_IDENTITY_GONE: 'PROVIDER_IDENTITY_GONE',
} as const;
export type IdentityErrorCode = (typeof IDENTITY_ERROR_CODES)[keyof typeof IDENTITY_ERROR_CODES];

export class IdentityError extends Error {
  constructor(
    readonly code: IdentityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
