### Task 2: Конфиг — параметры §4 и ConfigModule

**Files:**
- Modify: `packages/core/src/config/config.schema.ts`
- Create: `packages/core/src/config/config.tokens.ts`
- Create: `packages/core/src/config/config.module.ts`
- Modify: `packages/core/src/config/config.schema.spec.ts`

**Interfaces:**
- Consumes: существующий `loadConfig`.
- Produces: поля `ROOM_CODE_MIN_LEN: number` (дефолт 8, ≥ 6), `ROOM_PARTICIPANT_LIMIT: number` (дефолт 500, 1…100 000), `JOIN_RATE_LIMIT_IP: number` (дефолт 20, ≥ 1) на `AppConfig`; токен `APP_CONFIG: symbol`; `ConfigModule` (провайдит `APP_CONFIG` через `loadConfig(process.env)`). Потребители: RoomService (Task 3), MembershipService (Task 5).

- [ ] **Step 1: Написать failing-тесты**

Добавить в `packages/core/src/config/config.schema.spec.ts` внутрь `describe('loadConfig')`:

```ts
it('applies §4 defaults (REQ-ID-006, REQ-ID-013)', () => {
  const cfg = loadConfig({ ...base } as NodeJS.ProcessEnv);
  expect(cfg.ROOM_CODE_MIN_LEN).toBe(8);
  expect(cfg.ROOM_PARTICIPANT_LIMIT).toBe(500);
  expect(cfg.JOIN_RATE_LIMIT_IP).toBe(20);
});

it.each([
  ['ROOM_CODE_MIN_LEN', '5'],
  ['ROOM_PARTICIPANT_LIMIT', '0'],
  ['ROOM_PARTICIPANT_LIMIT', '100001'],
  ['JOIN_RATE_LIMIT_IP', '0'],
] as const)('throws when %s is out of range (%s)', (key, value) => {
  expect(() => loadConfig({ ...base, [key]: value } as NodeJS.ProcessEnv)).toThrow(
    new RegExp(key),
  );
});

it('coerces §4 params from strings', () => {
  const cfg = loadConfig({
    ...base,
    ROOM_CODE_MIN_LEN: '10',
    JOIN_RATE_LIMIT_IP: '5',
  } as NodeJS.ProcessEnv);
  expect(cfg.ROOM_CODE_MIN_LEN).toBe(10);
  expect(cfg.JOIN_RATE_LIMIT_IP).toBe(5);
});
```

- [ ] **Step 2: Прогнать — подтвердить RED**

Run: `pnpm --filter @mymozhem/core test -t "loadConfig"`
Expected: FAIL — `cfg.ROOM_CODE_MIN_LEN` is `undefined`.

- [ ] **Step 3: Реализовать**

`packages/core/src/config/config.schema.ts` — полная замена содержимого:

```ts
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
```

`packages/core/src/config/config.tokens.ts`:

```ts
// DI token for the validated startup config (REQ-OPS-003). Services inject AppConfig;
// nothing outside PrismaService reads process.env directly.
export const APP_CONFIG = Symbol('APP_CONFIG');
```

`packages/core/src/config/config.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { APP_CONFIG } from './config.tokens';
import { loadConfig } from './config.schema';

@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
```

- [ ] **Step 4: Прогнать — GREEN**

Run: `pnpm --filter @mymozhem/core test -t "loadConfig"`
Expected: PASS (7 тестов describe).

- [ ] **Step 5: Гейты + commit**

Run: `pnpm --filter @mymozhem/core lint && pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core test`
Expected: зелёные.

```bash
git add packages/core/src/config
git commit -m "feat(core): §4 join/code/participant config params + ConfigModule (REQ-OPS-003)"
```

---

