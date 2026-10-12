// Отдельный инстанс лимитера для refresh-эндпоинта (REQ-SEC-007) — не делит состояние
// с join-лимитером.
export const REFRESH_RATE_LIMITER = Symbol('REFRESH_RATE_LIMITER');

// ADR-012 (T5): отдельный инстанс лимитера для POST /auth/organizer (REQ-SEC-007,
// §4 login_rate_limit) — не делит состояние ни с join-, ни с refresh-лимитером.
export const ORGANIZER_BOOTSTRAP_RATE_LIMITER = Symbol('ORGANIZER_BOOTSTRAP_RATE_LIMITER');
