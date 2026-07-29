// DI token for the validated startup config (REQ-OPS-003). Services inject AppConfig;
// nothing outside PrismaService reads process.env directly.
export const APP_CONFIG = Symbol('APP_CONFIG');
