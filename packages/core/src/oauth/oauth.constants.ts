// Имена httpOnly-кук OAuth-флоу (REQ-ID-009, design §3). State/PKCE/redirect живут
// только в куках — никаких in-memory nonce-реестров (REQ-CORE-004). Атрибуты
// (httpOnly/secure/sameSite/maxAge) выставляет transport-слой (Task 7).
export const OAUTH_STATE_COOKIE = 'mm_oauth_state';
export const OAUTH_PKCE_COOKIE = 'mm_oauth_pkce';
export const OAUTH_REDIRECT_COOKIE = 'mm_oauth_redirect';
