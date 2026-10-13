### Task 2: Config — токен/транспорт параметры с инвариантами (REQ-OPS-003, REQ-SEC-002)

**REQ:** REQ-SEC-002 (JWT_SECRET ≥32 байт, обязателен), REQ-OPS-003 (единая схема, кросс-инварианты), REQ-ID-016 (REFRESH ≤ GUEST_TTL), REQ-SEC-008 (CORS без wildcard в prod), REQ-SEC-007 (REFRESH_RATE_LIMIT).

**Files:**
- Modify: `packages/core/src/config/config.schema.ts`
- Modify: `packages/core/src/config/config.schema.spec.ts`
- Modify: `packages/core/src/testing/test-config.ts`

**Interfaces:**
- Produces (новые поля `AppConfig`): `JWT_SECRET: string`, `ACCESS_TOKEN_TTL: number` (сек, default 900), `GUEST_TTL: number` (сек, default 86400), `REFRESH_TOKEN_TTL: number` (сек, default 86400), `REFRESH_RATE_LIMIT: number` (default 10), `TRUST_PROXY: boolean` (default false), `CORS_ORIGINS: string[]` (default []).

- [ ] **Step 1: Падающие тесты (добавить в config.schema.spec.ts)**

`base` в существующем файле обновить: `const base = { DATABASE_URL: '...', JWT_SECRET: 's'.repeat(32) };` — иначе ВСЕ существующие тесты упадут (JWT_SECRET обязателен). Новые тесты:
```ts
it('rejects a missing JWT_SECRET (REQ-SEC-002)', () => {
  expect(() => loadConfig({ DATABASE_URL: base.DATABASE_URL } as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/);
});
it('rejects JWT_SECRET shorter than 32 bytes (REQ-SEC-002)', () => {
  expect(() => loadConfig({ ...base, JWT_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/);
});
it('rejects REFRESH_TOKEN_TTL > GUEST_TTL (REQ-ID-016)', () => {
  expect(() => loadConfig({ ...base, GUEST_TTL: '3600', REFRESH_TOKEN_TTL: '7200' } as NodeJS.ProcessEnv)).toThrow(/REFRESH_TOKEN_TTL/);
});
it('rejects CORS wildcard in production (REQ-SEC-008)', () => {
  expect(() => loadConfig({ ...base, NODE_ENV: 'production', CORS_ORIGINS: '*' } as NodeJS.ProcessEnv)).toThrow(/CORS_ORIGINS/);
});
it('applies transport defaults', () => {
  const cfg = loadConfig({ ...base } as NodeJS.ProcessEnv);
  expect(cfg.ACCESS_TOKEN_TTL).toBe(900);
  expect(cfg.GUEST_TTL).toBe(86400);
  expect(cfg.REFRESH_TOKEN_TTL).toBe(86400);
  expect(cfg.REFRESH_RATE_LIMIT).toBe(10);
  expect(cfg.TRUST_PROXY).toBe(false);
  expect(cfg.CORS_ORIGINS).toEqual([]);
});
it('parses TRUST_PROXY and CORS_ORIGINS', () => {
  const cfg = loadConfig({ ...base, TRUST_PROXY: 'true', CORS_ORIGINS: 'https://a.example, https://b.example' } as NodeJS.ProcessEnv);
  expect(cfg.TRUST_PROXY).toBe(true);
  expect(cfg.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
});
```

- [ ] **Step 2: Прогнать — падает** (`pnpm --filter @mymozhem/core test -t loadConfig`)

- [ ] **Step 3: Реализация (config.schema.ts)**

Добавить в объект схемы:
```ts
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
  // Доверие к X-Forwarded-For — свойство деплоя, не кода (transport design §6).
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // REQ-SEC-008: allowlist origin; wildcard в production запрещён (superRefine).
  CORS_ORIGINS: z.string().default('').transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
```
и после `z.object({...})` навесить:
```ts
.superRefine((cfg, ctx) => {
  if (cfg.REFRESH_TOKEN_TTL > cfg.GUEST_TTL) {
    ctx.addIssue({ code: 'custom', path: ['REFRESH_TOKEN_TTL'], message: 'REFRESH_TOKEN_TTL must be <= GUEST_TTL (REQ-ID-016)' });
  }
  if (cfg.NODE_ENV === 'production' && cfg.CORS_ORIGINS.includes('*')) {
    ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'CORS wildcard is forbidden in production (REQ-SEC-008)' });
  }
});
```

Обновить `packages/core/src/testing/test-config.ts` — добавить в `TEST_CONFIG`:
```ts
  JWT_SECRET: 'test-only-secret-key-32-bytes-long!!',
  ACCESS_TOKEN_TTL: 900,
  GUEST_TTL: 86_400,
  REFRESH_TOKEN_TTL: 86_400,
  REFRESH_RATE_LIMIT: 10,
  TRUST_PROXY: false,
  CORS_ORIGINS: [],
```

- [ ] **Step 4: Прогнать — зелёно; прогнать ВСЮ unit-лану core** (`pnpm --filter @mymozhem/core test` — обязательный `JWT_SECRET` мог сломать другие места, вызывающие `loadConfig`)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config packages/core/src/testing/test-config.ts
git commit -m "feat(core): token/transport config params with cross-invariants (REQ-SEC-002, REQ-OPS-003, REQ-ID-016)"
```

---

