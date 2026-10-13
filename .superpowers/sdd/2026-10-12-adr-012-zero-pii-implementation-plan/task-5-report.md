# Task 5 report: POST /auth/organizer — bootstrap организатора

**Status:** DONE
**Commit:** `0f16856` — feat(core): POST /auth/organizer — bootstrap организатора по setup-токену (ADR-012): timing-safe сравнение, rate-limit до проверки, единственность через partial index

## Что реализовано

1. **`packages/core/src/auth/setup-token.ts`** — `setupTokenMatches(provided, expected)`: sha256-дайджесты обеих строк + `timingSafeEqual` (дайджесты выравнивают длину — кандидат любой длины не утекает ни длиной, ни временем; Review Focus 5).
2. **`IdentityService.findOrCreateOrganizer()`** (`packages/core/src/identity/identity.service.ts`) — findFirst живого REGISTERED → create `{kind:'REGISTERED', displayName:'Организатор'}` (email=NULL); проигравший гонку ловит P2002 от `Identity_single_registered_key` и перечитывает победителя; create вне `$transaction` (ловушка aborted-tx). Комментарий-инвариант у шапки сервиса уже был заложен T4 и теперь ссылается на реальный метод.
3. **Endpoint `POST /auth/organizer`** (`packages/core/src/transport/auth.controller.ts`) — порядок: лимитер (per-IP, `ORGANIZER_BOOTSTRAP_RATE_LIMITER`) → zod-parse тела → digest-сверка токена с `config.ORGANIZER_SETUP_TOKEN` → `findOrCreateOrganizer` → `issueRegisteredTokens` → `setRefreshCookie` → `TokenResponse`. Любой mismatch — 401 `ORGANIZER_SETUP_INVALID` (ContractError, wire-паритет через мапу фильтра).
4. **DI:** символ `ORGANIZER_BOOTSTRAP_RATE_LIMITER` в `auth.tokens.ts`; фабрика `new JoinRateLimiter(config.ORGANIZER_RATE_LIMIT)` в `transport.module.ts`; `IdentityModule` добавлен в `imports` TransportModule по ruling B-pre.1 (IdentityService транзитивно недостижим — MembershipModule экспортирует только MembershipService).
5. **Фильтр:** `STATUS_BY_WIRE_CODE += ORGANIZER_SETUP_INVALID: 401` (рядом с SESSION_INVALID) + спек-кейс.
6. **Barrel:** `export * from './auth/setup-token'` в `packages/core/src/index.ts` (произведённый интерфейс задачи).

## TDD evidence

### RED
- `pnpm --filter @mymozhem/core test -- setup-token` → `TS2307: Cannot find module './setup-token'` (suite failed).
- `pnpm --filter @mymozhem/core test:int -- organizer-bootstrap` → `TS2339: Property 'findOrCreateOrganizer' does not exist on type 'IdentityService'` (suite failed).
- `pnpm --filter @mymozhem/core test -- http-exception.filter` → `✕ organizer setup invalid → typed wire error without internals` (1 failed, 30 passed) — код падал в INTERNAL_ERROR до добавления в мапу.
- e2e первый прогон: все 5 кейсов failed с 404 (route не зарегистрирован — apps/server резолвит `@mymozhem/core` из dist; после `tsc -p` для core — GREEN).

### GREEN
- `pnpm --filter @mymozhem/core test -- setup-token` → 3 passed.
- `pnpm --filter @mymozhem/core test:int -- organizer-bootstrap` → 2 passed (race-тест 5 параллельных вызовов → ровно 1 REGISTERED; идемпотентность, email=NULL, displayName='Организатор').
- `pnpm --filter @mymozhem/core test -- http-exception.filter` → 31 passed.
- `pnpm --filter @mymozhem/server test -- organizer-bootstrap.e2e` → 5 passed.

### Полные прогоны (шаг 7)
- `pnpm --filter @mymozhem/core test` → 19 suites / 219 passed.
- `pnpm --filter @mymozhem/core test:int` → 23 suites / 210 passed.
- `pnpm --filter @mymozhem/server test` → 9 suites / 62 passed, 1 skipped (пропуск pre-existing).
- `pnpm boundary-check` → no dependency violations (721 modules) — новое ребро transport→identity разрешено правилами.
- `pnpm --filter @mymozhem/core lint` → clean.
- `pnpm --filter @mymozhem/core typecheck` → единственная ошибка — санкционированное красное `join.controller.ts(28,73)` TS2322 (владелец T6), не тронуто.

## Files changed

- Create: `packages/core/src/auth/setup-token.ts`, `packages/core/src/auth/setup-token.spec.ts`
- Modify: `packages/core/src/identity/identity.service.ts` (+`findOrCreateOrganizer`)
- Create: `packages/core/src/identity/organizer-bootstrap.int-spec.ts`
- Modify: `packages/core/src/transport/auth.controller.ts` (+handler, +DI), `packages/core/src/transport/auth.tokens.ts` (+символ), `packages/core/src/transport/transport.module.ts` (+IdentityModule, +фабрика)
- Modify: `packages/core/src/transport/http-exception.filter.ts` (+`ORGANIZER_SETUP_INVALID: 401`) + `http-exception.filter.spec.ts` (+кейс)
- Modify: `packages/core/src/index.ts` (+barrel setup-token)
- Create: `apps/server/test/organizer-bootstrap.e2e-spec.ts`

## Self-review findings

- **Review Focus 1 (гонка):** int-спек гоняет 5 параллельных `findOrCreateOrganizer` — все вернули один id, count=1. P2002-перечитывание работает поверх индекса T4.
- **Review Focus 5 (оракул):** e2e rate-limit кейс усилен относительно скелета брифа: после исчерпания лимита (2 неверных → 401) третий вызов идёт с ВЕРНЫМ токеном и получает 429 — это пинит порядок «лимитер ДО проверки токена» (если бы сверка шла первой, был бы 200). Плюс ассерт `identity.count()===0` — bootstrap не состоялся.
- **REQ-SEC-006:** e2e на неверный токен ассертит ровно `{code:'ORGANIZER_SETUP_INVALID'}` через `toEqual` (лишние ключи ловятся), отсутствие set-cookie и отсутствие созданной identity.
- **REQ-ID-008/016:** e2e пинит Set-Cookie `mm_refresh` (HttpOnly, SameSite=Strict, Path=/auth, без Secure вне prod), claims `kind=REGISTERED` без roomId; полный путь «bootstrap → POST /rooms → 201» без OAuth.
- Порядок в handler: лимитер → `parse(body)` → сверка. При исчерпанном лимите даже malformed body получит 429, а не 400 — согласовано с образцом refresh-handler (лимитер первым).
- dist-артефакты core пересобраны прямым `tsc -p` (санкционированное красное эмитит dist несмотря на exit 2); dist в .gitignore, в коммит не попал.

## Concerns

- Нет. Единственное наблюдение: `pnpm --filter @mymozhem/core typecheck` и root-прогоны падают на санкционированном красном T6 (join.controller TS2322) — ожидаемо, не моё.
