### Task 1: Конфиг `RECONNECT_RATE_LIMIT_PER_MIN`

**Files:**
- Modify: `packages/core/src/config/config.schema.ts` (после `EVENT_EMIT_RATE_LIMIT_PER_MIN`, ~line 26)
- Modify: `packages/core/src/config/config.schema.spec.ts` (в конец describe)
- Modify: `packages/core/src/testing/test-config.ts`

**Interfaces:**
- Consumes: ничего из новых задач.
- Produces: `AppConfig.RECONNECT_RATE_LIMIT_PER_MIN: number` — используется фабрикой лимитера в Task 6 и env-override'ом в e2e (Task 8).

- [ ] **Step 1: Failing test — дефолт и коэрсия нового параметра**

Добавить в конец `describe('loadConfig')` в `packages/core/src/config/config.schema.spec.ts`:

```ts
  it('applies §4 default for reconnect ceiling (REQ-RT-015)', () => {
    const cfg = configSchema.parse({
      DATABASE_URL: 'postgresql://x',
      JWT_SECRET: 'x'.repeat(32),
    });
    expect(cfg.RECONNECT_RATE_LIMIT_PER_MIN).toBe(10);
  });

  it('coerces RECONNECT_RATE_LIMIT_PER_MIN from string and rejects 0', () => {
    const envBase = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'x'.repeat(32) };
    expect(
      configSchema.parse({ ...envBase, RECONNECT_RATE_LIMIT_PER_MIN: '5' })
        .RECONNECT_RATE_LIMIT_PER_MIN,
    ).toBe(5);
    expect(
      configSchema.safeParse({ ...envBase, RECONNECT_RATE_LIMIT_PER_MIN: 0 }).success,
    ).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core test config.schema`
Expected: FAIL — `RECONNECT_RATE_LIMIT_PER_MIN` is undefined (проверить, что оба теста реально матчатся: в выводе 2 failed, не «0 tests»).

- [ ] **Step 3: Implementation**

В `packages/core/src/config/config.schema.ts` после строки `EVENT_EMIT_RATE_LIMIT_PER_MIN` добавить:

```ts
  // REQ-RT-015 (§4 reconnect_rate_limit): базовый per-identity потолок на
  // reconnect/replay, 10/мин. Объём amendment v1.3: потолок — ф.1; экспоненциальный
  // бэкофф и конфигурируемый режим — ф.4.
  RECONNECT_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(10),
```

В `packages/core/src/testing/test-config.ts` добавить поле (после `MAX_EVENT_PAYLOAD_BYTES`):

```ts
  RECONNECT_RATE_LIMIT_PER_MIN: 10,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mymozhem/core test config.schema`
Expected: PASS, все 16+ тестов файла.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/config.schema.ts packages/core/src/config/config.schema.spec.ts packages/core/src/testing/test-config.ts
git commit -m "feat(core): конфиг RECONNECT_RATE_LIMIT_PER_MIN (REQ-RT-015, объём v1.3)"
```

---

