### Task 1: Флаг `COOKIE_SECURE` (находка №2)

**Закрывает:** REQ-ID-008-контур (httpOnly нетронут), REQ-SEC-008-контур (дефолт нетронут); дизайн §2.

**Files:**
- Test: `packages/core/src/transport/refresh-cookie.spec.ts` (создать)
- Modify: `packages/core/src/config/config.schema.ts` (после блока TRUST_PROXY, ~стр. 51)
- Modify: `packages/core/src/transport/refresh-cookie.ts:20`
- Modify: `packages/core/src/testing/test-config.ts` (блок AppConfig)
- Modify: `packages/core/src/config/config.schema.spec.ts` (кейсы парсинга)
- Modify: `docker-compose.yml` (environment сервиса server)

**Interfaces:**
- Consumes: `AppConfig` (config.schema.ts), `ReplyLike` (http.types.ts), `TEST_CONFIG`.
- Produces: `AppConfig.COOKIE_SECURE: 'auto' | 'true' | 'false'` — потребителей в плане нет (читает только setRefreshCookie).

- [ ] **Step 1: Падающий unit-тест атрибута secure**

Создать `packages/core/src/transport/refresh-cookie.spec.ts`:

```ts
import { TEST_CONFIG } from '../testing/test-config';
import type { AppConfig } from '../config/config.schema';
import type { ReplyLike } from './http.types';
import { setRefreshCookie } from './refresh-cookie';

// Фейк ReplyLike: интересует только options.secure переданный в setCookie.
class FakeReply implements ReplyLike {
  cookieOptions: { secure: boolean } | null = null;
  setCookie(_name: string, _value: string, options: { secure: boolean }): unknown {
    this.cookieOptions = options;
    return this;
  }
  clearCookie(): unknown {
    return this;
  }
  redirect(): unknown {
    return this;
  }
}

const cfg = (over: Partial<AppConfig>): AppConfig => ({ ...TEST_CONFIG, ...over });

// Находка №2: LAN-стенд под NODE_ENV=production по plain HTTP — Secure-кука
// браузером не принимается. Флаг COOKIE_SECURE отделяет « Secure-атрибут» от
// NODE_ENV; дефолт auto = прежнее поведение (дизайн §2).
describe('setRefreshCookie + COOKIE_SECURE', () => {
  it.each([
    ['auto + production → secure', cfg({ COOKIE_SECURE: 'auto', NODE_ENV: 'production' }), true],
    ['auto + development → не secure', cfg({ COOKIE_SECURE: 'auto', NODE_ENV: 'development' }), false],
    ["'true' принудительно secure даже в development", cfg({ COOKIE_SECURE: 'true', NODE_ENV: 'development' }), true],
    ["'false' снимает secure даже в production (plain-HTTP LAN)", cfg({ COOKIE_SECURE: 'false', NODE_ENV: 'production' }), false],
  ] as const)('%s', (_label, config, expectedSecure) => {
    const reply = new FakeReply();
    setRefreshCookie(reply, 'refresh-token', config, 'REGISTERED');
    expect(reply.cookieOptions?.secure).toBe(expectedSecure);
  });
});
```

- [ ] **Step 2: Прогнать — должно падать**

Run: `pnpm --filter @mymozhem/core test -- refresh-cookie`
Expected: FAIL (TS: `COOKIE_SECURE` не существует в типе `AppConfig`).

- [ ] **Step 3: Падающий тест конфиг-парсинга**

В `packages/core/src/config/config.schema.spec.ts` добавить (стиль существующих кейсов файла):

```ts
it('COOKIE_SECURE: дефолт auto; принимает true/false; прочее — отказ', () => {
  const base = {
    DATABASE_URL: 'postgresql://localhost:5432/x',
    JWT_SECRET: 'x'.repeat(32),
    ORGANIZER_SETUP_TOKEN: 'y'.repeat(32),
  };
  expect(configSchema.parse(base).COOKIE_SECURE).toBe('auto');
  expect(configSchema.parse({ ...base, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe('false');
  expect(() => configSchema.parse({ ...base, COOKIE_SECURE: 'maybe' })).toThrow();
});
```

Run: `pnpm --filter @mymozhem/core test -- config.schema`
Expected: FAIL (`COOKIE_SECURE` unknown → дефолт не сработает; strict-схема либо выкинет ключ, либо упадёт — в любом случае первый ассерт красный).

- [ ] **Step 4: Реализация**

`config.schema.ts`, сразу после блока TRUST_PROXY:

```ts
  // ADR-012 self-hosted (находка №2): Secure-атрибут refresh-куки отделён от
  // NODE_ENV. auto — прежнее поведение (production = Secure); false — только
  // plain-HTTP LAN/self-hosted стенд. Hosted-деплой флаг не выставляет.
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
```

`refresh-cookie.ts` — заменить вычисление secure (и комментарий над функцией дополнить строкой про флаг):

```ts
  // COOKIE_SECURE (находка №2): auto — по NODE_ENV (прежняя норма), явное
  // значение побеждает (false — только plain-HTTP LAN, см. чеклист события).
  const secure =
    config.COOKIE_SECURE === 'auto'
      ? config.NODE_ENV === 'production'
      : config.COOKIE_SECURE === 'true';
```

и в `setCookie`-опциях использовать `secure` вместо `config.NODE_ENV === 'production'`.

`test-config.ts` — в TEST_CONFIG после `TRUST_PROXY: false,`:

```ts
  COOKIE_SECURE: 'auto',
```

- [ ] **Step 5: Прогнать — зелёное**

Run: `pnpm --filter @mymozhem/core test -- refresh-cookie`
Run: `pnpm --filter @mymozhem/core test -- config.schema`
Expected: PASS обе.

- [ ] **Step 6: Compose**

`docker-compose.yml`, environment сервера (рядом с TRUST_PROXY):

```yaml
      # ADR-012 self-hosted (находка №2): auto = Secure при NODE_ENV=production.
      # false — ТОЛЬКИ plain-HTTP LAN-стенд первого события (см. чеклист §0.4).
      COOKIE_SECURE: ${COOKIE_SECURE:-auto}
```

Проверка дефолта (Review Focus 4): `docker compose config` БЕЗ COOKIE_SECURE в окружении → в выводе `COOKIE_SECURE: auto`.

- [ ] **Step 7: Гейты + коммит**

Run: `pnpm --filter @mymozhem/core lint && pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core test`
Expected: зелёные (включая существующие cookie-потребители — auth.controller/join.controller спеки не тронуты, дефолт auto сохраняет поведение).

```bash
git add packages/core/src/transport/refresh-cookie.ts packages/core/src/transport/refresh-cookie.spec.ts packages/core/src/config/config.schema.ts packages/core/src/config/config.schema.spec.ts packages/core/src/testing/test-config.ts docker-compose.yml
git commit -m "feat(core): COOKIE_SECURE — Secure-атрибут refresh-куки отделён от NODE_ENV (находка №2, plain-HTTP LAN self-hosted)"
```

---

