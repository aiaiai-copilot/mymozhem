import { z } from 'zod';

// Startup config validation mechanism (REQ-OPS-003). §4 parameters arrive with the
// phases that need them; ranges are the hard bounds of the spec's §4 table.
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  // REQ-ID-013: room code length (§4: default 8, min 6).
  ROOM_CODE_MIN_LEN: z.coerce.number().int().min(6).default(8),
  // REQ-ID-006: max PARTICIPANT memberships per room (§4: default 500, 1..100 000).
  ROOM_PARTICIPANT_LIMIT: z.coerce.number().int().min(1).max(100_000).default(500),
  // REQ-ID-006: join attempts per minute per IP (§4: default 20, ≥ 1).
  JOIN_RATE_LIMIT_IP: z.coerce.number().int().min(1).default(20),
  // REQ-SEC-002: обязателен, ≥ 32 байта; дефолта нет — старт без секрета невозможен.
  JWT_SECRET: z.string().min(32),
  // §4: access_token_ttl — 15 мин, 1 мин … 1 ч (секунды).
  ACCESS_TOKEN_TTL: z.coerce.number().int().min(60).max(3600).default(900),
  // §4: guest_ttl — 24 ч, 1 ч … 30 сут (секунды).
  GUEST_TTL: z.coerce.number().int().min(3600).max(2_592_000).default(86_400),
  // REQ-ID-016: гостевой refresh ≤ guest_ttl (инвариант — superRefine ниже).
  REFRESH_TOKEN_TTL: z.coerce.number().int().min(60).default(86_400),
  // REQ-SEC-007 (§4 login_rate_limit): refresh-эндпоинт, 10/мин на IP.
  REFRESH_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  // REQ-RT-014 (§4 event_emit_rate_limit): эмиссия app-событий, 30/мин на actor (≥ 1).
  EVENT_EMIT_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(30),
  // REQ-RT-012 (§4 max_event_payload): 16 КБ, диапазон 1 КБ … 256 КБ (байты).
  MAX_EVENT_PAYLOAD_BYTES: z.coerce.number().int().min(1024).max(262_144).default(16_384),
  // Доверие к X-Forwarded-For — свойство деплоя, не кода (transport design §6).
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // REQ-SEC-008: allowlist origin; wildcard в production запрещён (superRefine).
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
})
  .superRefine((cfg, ctx) => {
    if (cfg.REFRESH_TOKEN_TTL > cfg.GUEST_TTL) {
      ctx.addIssue({
        code: 'custom',
        path: ['REFRESH_TOKEN_TTL'],
        message: 'REFRESH_TOKEN_TTL must be <= GUEST_TTL (REQ-ID-016)',
      });
    }
    if (cfg.NODE_ENV === 'production' && cfg.CORS_ORIGINS.includes('*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS wildcard is forbidden in production (REQ-SEC-008)',
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${detail}`);
  }
  return parsed.data;
}
