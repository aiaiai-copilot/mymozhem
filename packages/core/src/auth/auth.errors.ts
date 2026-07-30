// Core-internal auth errors. Наружу фильтр отдаёт один код SESSION_INVALID для всех
// отказов refresh — reuse/expired/unknown неразличимы снаружи (design §5, принцип REQ-ID-013).
export const AUTH_ERROR_CODES = { SESSION_INVALID: 'SESSION_INVALID' } as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
  }
}
