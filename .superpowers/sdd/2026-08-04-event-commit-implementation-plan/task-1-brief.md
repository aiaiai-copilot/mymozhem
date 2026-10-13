### Task 1: Конфиг-параметры эмиссии

**Files:**
- Modify: `packages/core/src/config/config.schema.ts`
- Test: `packages/core/src/config/config.schema.spec.ts`
- Modify: `packages/core/src/testing/test-config.ts`

**Interfaces:**
- Produces: `AppConfig.EVENT_EMIT_RATE_LIMIT_PER_MIN: number` (default 30), `AppConfig.MAX_EVENT_PAYLOAD_BYTES: number` (default 16384) — потребляются Task 2 (factory лимитера) и Task 5 (цепочка).

- [ ] **Step 1: Write the failing tests**

В `packages/core/src/config/config.schema.spec.ts` добавить (стиль существующих кейсов файла — посмотреть соседние `it` для формы вызова `configSchema.parse`/`safeParse`):

```ts
it('applies §4 defaults for event emission params', () => {
  const cfg = configSchema.parse({
    DATABASE_URL: 'postgresql://x',
    JWT_SECRET: 'x'.repeat(32),
  });
  expect(cfg.EVENT_EMIT_RATE_LIMIT_PER_MIN).toBe(30);
  expect(cfg.MAX_EVENT_PAYLOAD_BYTES).toBe(16_384);
});

it('rejects out-of-range event emission params (REQ-RT-012/014, §4 bounds)', () => {
  const base = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'x'.repeat(32) };
  expect(configSchema.safeParse({ ...base, EVENT_EMIT_RATE_LIMIT_PER_MIN: 0 }).success).toBe(false);
  expect(configSchema.safeParse({ ...base, MAX_EVENT_PAYLOAD_BYTES: 512 }).success).toBe(false);
  expect(configSchema.safeParse({ ...base, MAX_EVENT_PAYLOAD_BYTES: 300_000 }).success).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mymozhem/core test -t "event emission params"`
Expected: FAIL — `EVENT_EMIT_RATE_LIMIT_PER_MIN` не существует в типе/выводе. Убедиться, что фильтр матчит 2 теста (`2 failed` в выводе, не `0 tests`).

- [ ] **Step 3: Add the two params to configSchema**

В `packages/core/src/config/config.schema.ts` после `REFRESH_RATE_LIMIT`:

```ts
  // REQ-RT-014 (§4 event_emit_rate_limit): эмиссия app-событий, 30/мин на actor (≥ 1).
  EVENT_EMIT_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(30),
  // REQ-RT-012 (§4 max_event_payload): 16 КБ, диапазон 1 КБ … 256 КБ (байты).
  MAX_EVENT_PAYLOAD_BYTES: z.coerce.number().int().min(1024).max(262_144).default(16_384),
```

И в `packages/core/src/testing/test-config.ts` в литерал `TEST_CONFIG`:

```ts
  EVENT_EMIT_RATE_LIMIT_PER_MIN: 30,
  MAX_EVENT_PAYLOAD_BYTES: 16_384,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mymozhem/core test -t "event emission params"` → PASS (2 теста).
Run: `pnpm --filter @mymozhem/core test` → весь unit-suite зелёный.
Run: `pnpm typecheck` → зелёный (TEST_CONFIG типизирован `AppConfig` — без Step 3 второй части был бы type error).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/config.schema.ts packages/core/src/config/config.schema.spec.ts packages/core/src/testing/test-config.ts
git commit -m "feat(core): config params EVENT_EMIT_RATE_LIMIT_PER_MIN/MAX_EVENT_PAYLOAD_BYTES (REQ-RT-012/014, §4)"
```

---

