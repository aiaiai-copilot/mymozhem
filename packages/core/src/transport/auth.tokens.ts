// Отдельный инстанс лимитера для refresh-эндпоинта (REQ-SEC-007) — не делит состояние
// с join-лимитером.
export const REFRESH_RATE_LIMITER = Symbol('REFRESH_RATE_LIMITER');

// Отдельные инстансы лимитеров для OAuth-эндпоинтов (REQ-SEC-007): start и callback
// не делят состояние ни между собой, ни с join/refresh.
export const OAUTH_START_RATE_LIMITER = Symbol('OAUTH_START_RATE_LIMITER');
export const OAUTH_CALLBACK_RATE_LIMITER = Symbol('OAUTH_CALLBACK_RATE_LIMITER');
