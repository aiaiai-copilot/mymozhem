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
