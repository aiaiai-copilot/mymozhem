// DI-токен per-identity лимитера reconnect/replay (REQ-RT-015, объём v1.3).
// Отдельный инстанс JoinRateLimiter — состояние не делится с join/refresh
// лимитерами (конвенция REFRESH_RATE_LIMITER транспортного среза).
export const RECONNECT_RATE_LIMITER = Symbol('RECONNECT_RATE_LIMITER');
