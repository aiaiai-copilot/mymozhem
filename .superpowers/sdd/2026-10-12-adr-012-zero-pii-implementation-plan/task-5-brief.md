### Task 5: POST /auth/organizer — bootstrap организатора

**REQ:** REQ-ID-005 (организатор = REGISTERED), REQ-ID-016 (единые токены), REQ-ID-008 (refresh — httpOnly-кука), REQ-SEC-002 (setup-токен ≥32), REQ-SEC-007 (rate-limit до проверки), REQ-SEC-006 (наружу только код).

**Files:**
- Create: `packages/core/src/auth/setup-token.ts` + `packages/core/src/auth/setup-token.spec.ts`
- Modify: `packages/core/src/identity/identity.service.ts` (+= `findOrCreateOrganizer`)
- Create: `packages/core/src/identity/organizer-bootstrap.int-spec.ts`
- Modify: `packages/core/src/transport/auth.controller.ts` (+= endpoint), `packages/core/src/transport/auth.tokens.ts` (+= символ), `packages/core/src/transport/transport.module.ts` (+= фабрика)
- Modify: `packages/core/src/transport/http-exception.filter.ts` (+= `ORGANIZER_SETUP_INVALID: 401`) + спек
- Create: `apps/server/test/organizer-bootstrap.e2e-spec.ts`

**Interfaces:**
- Consumes: T2 (`organizerBootstrapRequestSchema`, код `ORGANIZER_SETUP_INVALID`, `TokenResponse`), T3 (`ORGANIZER_SETUP_TOKEN`, `ORGANIZER_RATE_LIMIT`), T4 (индекс).
- Produces: endpoint `POST /auth/organizer` (потребитель — T9 web/seed/smoke); `IdentityService.findOrCreateOrganizer(): Promise<Identity>`; `setupTokenMatches(provided: string, expected: string): boolean`; символ `ORGANIZER_BOOTSTRAP_RATE_LIMITER`.

- [ ] **Step 1: Падающий unit на сравнение токена** — `setup-token.spec.ts`:

```ts
import { setupTokenMatches } from './setup-token';

describe('setupTokenMatches (ADR-012, REQ-SEC-002)', () => {
  const expected = 'correct-token-32-bytes-long-string!';
  it('matches identical strings', () => expect(setupTokenMatches(expected, expected)).toBe(true));
  it('rejects a wrong token of the same length', () =>
    expect(setupTokenMatches('x'.repeat(expected.length), expected)).toBe(false));
  it('rejects without leaking length (shorter/longer candidates)', () => {
    expect(setupTokenMatches('short', expected)).toBe(false);
    expect(setupTokenMatches(expected + 'x', expected)).toBe(false);
    expect(setupTokenMatches('', expected)).toBe(false);
  });
});
```

- [ ] **Step 2: Реализация сравнения** — `setup-token.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto';

// Сравнение через sha256-дайджесты: timingSafeEqual требует равной длины буферов,
// а дайджесты выравнивают длину — кандидат любой длины не утекает ни длиной,
// ни временем (Review Focus 5).
export function setupTokenMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 3: Падающий int на identity + endpoint-контур.** `organizer-bootstrap.int-spec.ts` (по образцу существующих identity int-спек — testcontainer, `TEST_CONFIG`):

```ts
it('creates exactly one REGISTERED under concurrent bootstrap (Review Focus 1)', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => identity.findOrCreateOrganizer()));
  const ids = new Set(results.map((i) => i.id));
  expect(ids.size).toBe(1);
  const count = await prisma.identity.count({ where: { kind: 'REGISTERED', deletedAt: null } });
  expect(count).toBe(1);
});
it('is idempotent: repeat calls return the same identity with email=NULL', async () => {
  const first = await identity.findOrCreateOrganizer();
  const second = await identity.findOrCreateOrganizer();
  expect(second.id).toBe(first.id);
  expect(first.email).toBeNull();
  expect(first.displayName).toBe('Организатор');
});
```

- [ ] **Step 4: Реализация `findOrCreateOrganizer`** — в `identity.service.ts`:

```ts
// ADR-012 §2: единственный REGISTERED инстанса, email = NULL. Гонка первых
// bootstrap'ов: проигравший ловит P2002 от "Identity_single_registered_key" и
// перечитывает победителя. create ВНЕ $transaction — catch P2002 не отравляет
// чужую tx (ловушка aborted-tx). Инвариант — см. комментарий у шапки сервиса.
async findOrCreateOrganizer(): Promise<Identity> {
  const existing = await this.prisma.identity.findFirst({
    where: { kind: 'REGISTERED', deletedAt: null },
  });
  if (existing) return existing;
  try {
    return await this.prisma.identity.create({
      data: { kind: 'REGISTERED', displayName: 'Организатор' },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await this.prisma.identity.findFirst({
        where: { kind: 'REGISTERED', deletedAt: null },
      });
      if (winner) return winner;
    }
    throw err;
  }
}
```

- [ ] **Step 5: Endpoint.** `auth.tokens.ts` += `export const ORGANIZER_BOOTSTRAP_RATE_LIMITER = Symbol('ORGANIZER_BOOTSTRAP_RATE_LIMITER');`. `transport.module.ts` += фабрика (рядом с REFRESH):

```ts
{
  provide: ORGANIZER_BOOTSTRAP_RATE_LIMITER,
  useFactory: (config: AppConfig) => new JoinRateLimiter(config.ORGANIZER_RATE_LIMIT),
  inject: [APP_CONFIG],
},
```

`auth.controller.ts` — новый handler (конструктор += `@Inject(ORGANIZER_BOOTSTRAP_RATE_LIMITER) private readonly organizerRateLimiter: JoinRateLimiter` и `private readonly identity: IdentityService`; AuthModule экспортирует только TokenService — добавить `IdentityModule` в `imports` TransportModule уже есть? — проверить: transport.module L23 импортирует MembershipModule, AuthModule, RoomModule… IdentityModule транзитивно через MembershipModule; если DI не разрешится — добавить IdentityModule в imports TransportModule, прецедент T7-шова Quiz-среза):

```ts
// ADR-012 §2: bootstrap единственного организатора по setup-токену. Лимитер —
// ДО проверки токена (нет оракула «верный, но лимит»); отказ одинаков при любом
// mismatch (401 ORGANIZER_SETUP_INVALID), повтор — та же identity, новая пара.
@Post('organizer')
@HttpCode(200)
async organizer(
  @Body() body: unknown,
  @Req() req: RequestLike,
  @Res({ passthrough: true }) reply: ReplyLike,
): Promise<TokenResponse> {
  if (!this.organizerRateLimiter.tryAcquire(req.ip)) {
    throw new JoinRateLimitedError('organizer bootstrap rate limit exceeded'); // 429 RATE_LIMITED
  }
  const { setupToken } = organizerBootstrapRequestSchema.parse(body);
  if (!setupTokenMatches(setupToken, this.config.ORGANIZER_SETUP_TOKEN)) {
    throw new ContractError('ORGANIZER_SETUP_INVALID', 'organizer setup token mismatch');
  }
  const identity = await this.identity.findOrCreateOrganizer();
  const issued = await this.tokens.issueRegisteredTokens(identity.id);
  setRefreshCookie(reply, issued.refreshToken, this.config, issued.kind);
  return { accessToken: issued.accessToken, tokenType: 'Bearer', expiresIn: issued.expiresIn };
}
```

`http-exception.filter.ts`: `STATUS_BY_WIRE_CODE` += `ORGANIZER_SETUP_INVALID: 401` (рядом с SESSION_INVALID; ContractError wire-parity ветка уже существует — код покрывается членством в мапе). Спек фильтра: строка маппинга + кейс «ContractError ORGANIZER_SETUP_INVALID → 401».

- [ ] **Step 6: e2e** — `apps/server/test/organizer-bootstrap.e2e-spec.ts` по образцу удалённого `oauth.e2e-spec.ts` (бут реального AppModule с env-override: `ORGANIZER_SETUP_TOKEN`):

```ts
// Скелет сценариев (детали бута — по образцу oauth.e2e-spec.ts env save/restore):
it('rejects a wrong token: 401 {code: ORGANIZER_SETUP_INVALID}, без куки', ...);
it('bootstraps: 200, TokenResponse по SDK-схеме, Set-Cookie mm_refresh (Path=/auth, HttpOnly)', ...);
it('second call returns the SAME identity (claims.sub совпадает) и новую токен-пару', ...);
it('bootstrapped organizer creates a room: POST /rooms с access → 201 (полный путь без OAuth)', ...);
it('rate limit: N+1 вызовов с неверным токеном → 429 RATE_LIMITED (лимитер до проверки токена)', ...);
```

- [ ] **Step 7: Прогоны**

```bash
pnpm --filter @mymozhem/core test -- setup-token
pnpm --filter @mymozhem/core test:int -- organizer-bootstrap
pnpm --filter @mymozhem/server test -- organizer-bootstrap.e2e
pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/server test
# Expected: все PASS. Помнить: NODE_OPTIONS зашит в test-скрипт server; точечный прогон — по уникальному имени файла.
```

- [ ] **Step 8: Commit**

```bash
git add packages/core apps/server
git commit -m "feat(core): POST /auth/organizer — bootstrap организатора по setup-токену (ADR-012): timing-safe сравнение, rate-limit до проверки, единственность через partial index"
```

---

