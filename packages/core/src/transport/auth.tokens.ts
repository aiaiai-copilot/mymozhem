// Отдельный инстанс лимитера для refresh-эндпоинта (REQ-SEC-007) — не делит состояние
// с join-лимитером.
export const REFRESH_RATE_LIMITER = Symbol('REFRESH_RATE_LIMITER');
