import type { AppConfig } from '../config/config.schema';

// Shared AppConfig for int-specs. Values are inert: DATABASE_URL is unused because
// startTestDb() points PrismaService at a throwaway testcontainer.
export const TEST_CONFIG: AppConfig = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://unused',
  ROOM_CODE_MIN_LEN: 8,
  ROOM_PARTICIPANT_LIMIT: 500,
  JOIN_RATE_LIMIT_IP: 20,
  JWT_SECRET: 'test-only-secret-key-32-bytes-long!!',
  ACCESS_TOKEN_TTL: 900,
  GUEST_TTL: 86_400,
  // REFRESH_TOKEN_TTL — новый дефолт §4 (30 сут): registered-ветки int-спеков должны
  // видеть TTL > GUEST_TTL (гостевой cap применяется при выдаче, не в конфиге).
  REFRESH_TOKEN_TTL: 2_592_000,
  REFRESH_RATE_LIMIT: 10,
  EVENT_EMIT_RATE_LIMIT_PER_MIN: 30,
  MAX_EVENT_PAYLOAD_BYTES: 16_384,
  RECONNECT_RATE_LIMIT_PER_MIN: 10,
  TRUST_PROXY: false,
  CORS_ORIGINS: [],
  // Google-секция опциональна (all-or-none) — в тестовом конфиге отсутствует.
  OAUTH_STATE_TTL: 600,
  OAUTH_RATE_LIMIT: 10,
  OAUTH_REDIRECT_ALLOWLIST: [],
};
