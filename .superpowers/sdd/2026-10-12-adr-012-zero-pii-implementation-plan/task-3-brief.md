### Task 3: Конфиг — новые параметры, снятие OAuth-секции

**REQ:** REQ-SEC-002 (обязательный секрет ≥32), REQ-OPS-003 (валидация конфига при старте), REQ-SEC-007 (rate-limit bootstrap-эндпоинта).

**Files:**
- Modify: `packages/core/src/config/config.schema.ts` (удалить строки 57–75 и Google-блок superRefine 87–102; добавить три ключа)
- Modify: `packages/core/src/config/config.schema.spec.ts` (заменить oauth-кейсы строк 79–110 новыми)
- Modify: `packages/core/src/testing/test-config.ts` (TEST_CONFIG)

**Interfaces:**
- Produces (потребители — T4, T5, T7): `AppConfig.ORGANIZER_SETUP_TOKEN: string`, `AppConfig.ORGANIZER_RATE_LIMIT: number`, `AppConfig.PRIZE_MODE: 'off' | 'on'`. Из `AppConfig` исчезают `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `OAUTH_REDIRECT_ALLOWLIST`, `OAUTH_STATE_TTL`, `OAUTH_RATE_LIMIT`.

- [ ] **Step 1: Падающие тесты** — в `config.schema.spec.ts` удалить кейсы Google-секции (allowlist-required, allowlist parsing, all-or-none) и добавить:

```ts
describe('ADR-012 параметры', () => {
  const base = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 's'.repeat(32), ORGANIZER_SETUP_TOKEN: 't'.repeat(32) };
  it('requires ORGANIZER_SETUP_TOKEN (fail-fast, образец JWT_SECRET/REQ-SEC-002)', () => {
    const { ORGANIZER_SETUP_TOKEN: _drop, ...env } = base;
    expect(() => loadConfig(env)).toThrow(/ORGANIZER_SETUP_TOKEN/);
  });
  it('rejects ORGANIZER_SETUP_TOKEN shorter than 32 bytes', () => {
    expect(() => loadConfig({ ...base, ORGANIZER_SETUP_TOKEN: 'short' })).toThrow(/ORGANIZER_SETUP_TOKEN/);
  });
  it('defaults PRIZE_MODE to off and ORGANIZER_RATE_LIMIT to 10', () => {
    const cfg = loadConfig(base);
    expect(cfg.PRIZE_MODE).toBe('off');
    expect(cfg.ORGANIZER_RATE_LIMIT).toBe(10);
  });
  it('accepts PRIZE_MODE=on', () => {
    expect(loadConfig({ ...base, PRIZE_MODE: 'on' }).PRIZE_MODE).toBe('on');
  });
});
```

(Сверить с существующими хелперами спеки — если есть общий `validEnv`, использовать его, добавив `ORGANIZER_SETUP_TOKEN`.)

- [ ] **Step 2: Прогон — красные**

```bash
pnpm --filter @mymozhem/core test -- config.schema
# Expected: FAIL — ORGANIZER_SETUP_TOKEN неизвестен схеме
```

- [ ] **Step 3: Реализация** — в `config.schema.ts`:

Удалить ключи `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `OAUTH_REDIRECT_ALLOWLIST`, `OAUTH_STATE_TTL`, `OAUTH_RATE_LIMIT` (строки 57–75) и оба Google-if в `superRefine` (строки 87–102; CORS-ветка superRefine остаётся).

Добавить после `JWT_SECRET`:

```ts
  // ADR-012 §2: bootstrap единственного организатора инстанса. Обязателен,
  // ≥ 32 байта; дефолта нет — старт без токена невозможен (образец REQ-SEC-002).
  ORGANIZER_SETUP_TOKEN: z.string().min(32),
  // REQ-SEC-007 (§4 login_rate_limit): POST /auth/organizer, 10/мин на IP.
  ORGANIZER_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  // ADR-012 §4: призовой режим. off — создание призов и розыгрыш с призом
  // отклоняются PRIZES_DISABLED; on — юридическая ответственность организатора.
  PRIZE_MODE: z.enum(['off', 'on']).default('off'),
```

В `test-config.ts`: удалить `OAUTH_STATE_TTL`, `OAUTH_RATE_LIMIT`, `OAUTH_REDIRECT_ALLOWLIST`; добавить `ORGANIZER_SETUP_TOKEN: 'test-only-organizer-setup-token!!'` (≥32 символа), `ORGANIZER_RATE_LIMIT: 10`, `PRIZE_MODE: 'off'`.

- [ ] **Step 4: Прогон — зелёные**

```bash
pnpm --filter @mymozhem/core test -- config.schema
# Expected: PASS
```

- [ ] **Step 5: Каскад.** Красные места от удалённых ключей: `transport.module.ts` (фабрики OAUTH-лимитеров), `oauth.service.ts`, `oauth.e2e-spec.ts`, `main.ts`? — все в инвентаре T4. Проверить `grep -rn 'OAUTH_\|GOOGLE_' packages/core/src apps/server/src apps/server/test` — каждое попадание обязано быть в инвентаре T4; иное — стоп, эскалация. Дерево красное до T4 — ожидаемо.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config packages/core/src/testing/test-config.ts
git commit -m "feat(core): конфиг ADR-012 — ORGANIZER_SETUP_TOKEN (обязателен, ≥32), ORGANIZER_RATE_LIMIT, PRIZE_MODE (default off); снята OAuth-секция (OAUTH_*/GOOGLE_*)"
```

---

## Батч B — ядро (сессия 2)

