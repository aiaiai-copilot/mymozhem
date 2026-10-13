import type { FastifyHelmetOptions } from '@fastify/helmet';

// REQ-SEC-008: security-заголовки — helmet с дефолтами, кроме CSP-директивы
// upgrade-insecure-requests (null = директива снята, helmet 8). UIR исполняется
// браузером и по plain-HTTP (в отличие от HSTS, который по HTTP игнорируется):
// на self-hosted LAN-стенде (http://<ip>:3000, топология первого события)
// сабресурсы SPA уходили на несуществующий https-порт — белый экран
// (найдено репетицией 2026-10-13). При появлении TLS-терминатора апгрейд
// сабресурсов обеспечит HSTS — директиву не возвращать без решения владельца.
// Опции ОБЩИЕ для prod-bootstrap (main.ts) и e2e-boot'ов (test/*): единственная
// точка, чтобы тестовый boot не дрейфовал от боевого (пин — transport.e2e).
export const HELMET_OPTIONS: FastifyHelmetOptions = {
  contentSecurityPolicy: {
    directives: { 'upgrade-insecure-requests': null },
  },
};
