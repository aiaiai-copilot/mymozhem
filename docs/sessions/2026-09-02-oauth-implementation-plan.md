# OAuth-срез (Google login + POST /rooms + REGISTERED-токены) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Регистрация/логин REGISTERED-identity через Google OAuth (state double-submit + PKCE, redirect по allowlist), выдача REGISTERED-токенов без guest-cap, `POST /rooms` для организатора — полный путь REQ-ID-015/009 от redirect'а до созданной комнаты.

**Architecture:** SDK-контракт 1.4.0 (новые DTO + wire-коды) → конфиг (опциональная Google-секция all-or-none, пересмотр REFRESH_TOKEN_TTL) → миграция `identity."IdentityProvider"` → `TokenService` с kind-aware TTL + `IdentityService.findOrCreateByProvider` → новый модуль `core/src/oauth` (порт `OAuthProviderClient` + `GoogleOAuthClient` + `OAuthService`) → transport (`GET /auth/google`, `GET /auth/google/callback`, `POST /rooms`, ветки фильтра) → e2e на проводе с `FakeOAuthProviderClient`. Дизайн: `docs/sessions/2026-09-02-oauth-design.md` — §0 решения владельца не переоткрывать.

**Tech Stack:** NestJS 11 (Fastify), Prisma 7.8 (adapter-pg, multiSchema), zod v4 SDK-контракт, jsonwebtoken, jest + testcontainers (postgres:17), global fetch (Node 24).

**Spec:** `docs/sessions/2026-09-02-oauth-design.md` (обязателен к чтению исполнителем; план аргументирует от него).

**Закрываемые REQ-\* (сверка первой стадии ревью):** REQ-ID-015 (Google OAuth, provider-данные отдельной таблицей), REQ-ID-009 (state nonce + redirect allowlist), REQ-SEC-007 ч. (rate-limit OAuth-эндпоинтов), REQ-ID-005 HTTP-путь (организатор — только REGISTERED), REQ-ID-016/007/008 REGISTERED-ветка (единый токен-механизм без guest-cap), REQ-OPS-003 (единая конфиг-схема, all-or-none), REQ-SEC-006 (наружу ровно `{code}`), REQ-CTR-004/005 (контракт 1.4.0 аддитивно + фикстуры), REQ-DEV-006 ч. (миграция с автотестом наличия).

## Global Constraints

- **Замороженные миграции не трогаем** — только новая миграция (HANDOFF, долгоживущие ограничения).
- **zod v4:** `z.uuid()` требует валидный RFC 9562 version nibble — в тестах только v4-совместимые UUID (прецедент: `00000000-0000-4000-8000-000000000001`). `z.url()`/`z.email()` — v4-формы (НЕ `z.string().url()`).
- **Порядок сборки:** core резолвит `@mymozhem/sdk` из dist — после правок SDK обязателен `pnpm --filter @mymozhem/sdk build` перед тестами core; apps/server e2e резолвит `@mymozhem/core` из dist — перед `pnpm --filter @mymozhem/server test` обязателен `pnpm build` в корне.
- **Int/e2e поднимают контейнеры Postgres** — Docker Desktop запущен; хост-порты 5432 и 55432 заняты чужими контейнерами (`lt-pg`, `lt-pg-sdd`, не трогать); authoring-контейнер миграций — на свободном порту (55433 уже использовался — проверять занятость).
- **Jest CLI:** рабочая форма `pnpm --filter @mymozhem/core test:int -t "..."` — БЕЗ `--`; фильтр проверять на >0 матчей.
- **Prisma 7 CLI работает только из корня репо** (`prisma.config.ts` там): `pnpm exec prisma …` из корня; `prisma generate` требует DATABASE_URL в env.
- **Контроллеры статусов не знают** — маппинг ошибка→HTTP только в `HttpExceptionFilter`; наружу ровно `{code}` (REQ-SEC-006).
- **Состояния процесса нет** (REQ-CORE-004): OAuth state/PKCE — только в httpOnly-куках, никаких in-memory nonce-реестров.
- **Conventional commits** в стиле репозитория (`feat(core): …`, `test(server): …`, …), Co-Authored-By трейлер.
- **После каждого таска** — коммит; красный CI-гейт чинится в том же таске.

---

### Task 1: SDK — wire-коды, DTO комнат/OAuth, контракт 1.4.0

**Files:**
- Modify: `packages/sdk/src/errors/error-codes.ts`
- Modify: `packages/sdk/src/errors/error-codes.contract.spec.ts`
- Create: `packages/sdk/src/room/create-room-request.ts`
- Create: `packages/sdk/src/room/create-room-request.fixtures.ts`
- Create: `packages/sdk/src/room/create-room-request.contract.spec.ts`
- Create: `packages/sdk/src/room/create-room-response.ts`
- Create: `packages/sdk/src/room/create-room-response.contract.spec.ts`
- Create: `packages/sdk/src/auth/oauth-start-query.ts`
- Create: `packages/sdk/src/auth/oauth-callback-query.ts`
- Create: `packages/sdk/src/auth/oauth-query.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/src/contract-version.ts` (`CONTRACT_VERSION = '1.4.0'`)
- Modify: `packages/sdk/package.json` (`"version": "1.4.0"`)

**Interfaces:**
- Produces: `createRoomRequestSchema` (input `{ joinPolicy?: RoomJoinPolicy }`, output `{ joinPolicy: RoomJoinPolicy }` — default `'guests'`), тип `CreateRoomRequest`; `roomStatusSchema` (`z.enum(['DRAFT','ACTIVE','COMPLETED','CANCELLED'])`), тип `RoomStatus`; `createRoomResponseSchema` (`strictObject({ roomId, code, joinPolicy, status })`), тип `CreateRoomResponse`; `oauthStartQuerySchema` (`strictObject({ redirect?: string })`); `oauthCallbackQuerySchema` (`strictObject({ code?, state?, error? })`); 8 новых `ContractErrorCode`; `CONTRACT_VERSION = '1.4.0'`. Потребители: RoomsController/OAuthController (Task 7), e2e (Task 8).
- Consumes: `roomJoinPolicySchema` из `packages/sdk/src/membership/room-join-policy.ts` (уже экспортирован).

- [ ] **Step 1: Падающий контрактный спек кодов**

Modify `packages/sdk/src/errors/error-codes.contract.spec.ts` — восемь кодов в ожидаемый упорядоченный перечень: `ROOM_ORGANIZER_NOT_REGISTERED` — в room-блок после `ROOM_SETTINGS_FROZEN`; oauth-блок — после `SESSION_INVALID`, перед `INTERNAL_ERROR`:

```ts
      'ROOM_SETTINGS_FROZEN',
      'ROOM_ORGANIZER_NOT_REGISTERED',
      'ACTOR_NOT_MEMBER',
      // ...
      'SESSION_INVALID',
      // OAuth-срез (REQ-ID-015/009, design 2026-09-02 §7).
      'OAUTH_NOT_CONFIGURED',
      'OAUTH_REDIRECT_INVALID',
      'OAUTH_STATE_INVALID',
      'OAUTH_ACCESS_DENIED',
      'OAUTH_EXCHANGE_FAILED',
      'OAUTH_EMAIL_UNVERIFIED',
      'OAUTH_EMAIL_CONFLICT',
      'INTERNAL_ERROR',
```

- [ ] **Step 2: Реализация кодов**

Modify `packages/sdk/src/errors/error-codes.ts` — те же коды в `CONTRACT_ERROR_CODES` в том же порядке (комментарии в стиле существующих блоков).

- [ ] **Step 3: Падающие спеки DTO**

Create `packages/sdk/src/room/create-room-request.contract.spec.ts` и `create-room-response.contract.spec.ts` по паттерну `join-request.contract.spec.ts` (it.each: request — по фикстурам из файла; response — инлайн-массивы в спеке, fixtures-файл только у request). Ключевые кейсы: request принимает `{}` (дефолт joinPolicy), отклоняет лишние ключи и `joinPolicy: 'admin'`; response отклоняет невалидный uuid, `status: 'PAUSED'`, лишние ключи; request-фикстура показывает, что `{}` → `{ joinPolicy: 'guests' }`.

Create `packages/sdk/src/auth/oauth-query.contract.spec.ts`: start принимает `{}` и `{ redirect: 'http://localhost:3000/app' }`, отклоняет лишние ключи; callback принимает `{code, state}`, `{error: 'access_denied'}`, `{}`, отклоняет лишние ключи.

- [ ] **Step 4: Реализация DTO + фикстуры**

Create `packages/sdk/src/room/create-room-request.ts`:

```ts
import { z } from 'zod';
import { roomJoinPolicySchema } from '../membership/room-join-policy';

// POST /rooms request body (REQ-ID-005 HTTP-путь, design 2026-09-02 §6). strict: лишние
// ключи не проходят границу. Пустое тело → дефолт 'guests' (REQ-ID-002).
export const createRoomRequestSchema = z.strictObject({
  joinPolicy: roomJoinPolicySchema.default('guests'),
});
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
```

Create `packages/sdk/src/room/create-room-response.ts`:

```ts
import { z } from 'zod';
import { roomJoinPolicySchema } from '../membership/room-join-policy';

// Wire-форма статуса комнаты принадлежит контракту (design §6); core-тип RoomStatus
// в room-state-machine.ts держит те же строки — сервис кастует на границе.
export const roomStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED']);
export type RoomStatus = z.infer<typeof roomStatusSchema>;

export const createRoomResponseSchema = z.strictObject({
  roomId: z.uuid(),
  code: z.string().trim().min(1),
  joinPolicy: roomJoinPolicySchema,
  status: roomStatusSchema,
});
export type CreateRoomResponse = z.infer<typeof createRoomResponseSchema>;
```

Create `packages/sdk/src/auth/oauth-start-query.ts` и `oauth-callback-query.ts`:

```ts
import { z } from 'zod';

// GET /auth/google query (REQ-ID-009): redirect валидируется сервером по allowlist,
// здесь — только форма. strict: лишние ключи не проходят.
export const oauthStartQuerySchema = z.strictObject({
  redirect: z.string().optional(),
});
export type OAuthStartQuery = z.infer<typeof oauthStartQuerySchema>;
```

```ts
import { z } from 'zod';

// GET /auth/google/callback query (REQ-ID-009): code+state при успехе, error при
// отказе пользователя — все optional, семантику разбирает OAuthService.
export const oauthCallbackQuerySchema = z.strictObject({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;
```

Create `create-room-request.fixtures.ts` (valid: `{}`, `{ joinPolicy: 'registered' }`, `{ joinPolicy: 'invite_only' }`; invalid: `{ joinPolicy: 'admin' }`, `{ extra: true }`, `'not-an-object'`).

- [ ] **Step 5: Версия, экспорты, сборка**

`contract-version.ts`: `CONTRACT_VERSION = '1.4.0'`. `package.json`: `"version": "1.4.0"`. `index.ts`: реэкспорты новых модулей (два room-* файла, два oauth-*-query файла). Прогон: `pnpm --filter @mymozhem/sdk test` → зелёный (включая parity-спек версии); `pnpm --filter @mymozhem/sdk build`.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): контракт 1.4.0 — OAuth wire-коды, createRoom DTO, oauth query-схемы (REQ-ID-015/009)"
```

---

### Task 2: Конфиг — Google-секция all-or-none, пересмотр REFRESH_TOKEN_TTL

**Files:**
- Modify: `packages/core/src/config/config.schema.ts`
- Modify: `packages/core/src/config/config.schema.spec.ts`
- Modify: `packages/core/src/testing/test-config.ts`

**Interfaces:**
- Produces (в `AppConfig`): `GOOGLE_CLIENT_ID?: string`, `GOOGLE_CLIENT_SECRET?: string`, `OAUTH_REDIRECT_URI?: string`, `OAUTH_REDIRECT_ALLOWLIST: string[]`, `OAUTH_STATE_TTL: number` (default 600, 60…1800), `OAUTH_RATE_LIMIT: number` (default 10). `REFRESH_TOKEN_TTL`: диапазон 86 400…7 776 000, default 2 592 000 (§4 пакета); superRefine `REFRESH ≤ GUEST_TTL` **снят** (design §5/§8 — инвариант REQ-ID-016 про гостевой refresh, он применяется в точках выдачи, Task 4). Потребители: OAuthService/GoogleOAuthClient (Task 6), лимитеры (Task 7), TEST_CONFIG — все int/e2e.

- [ ] **Step 1: Падающие спеки**

Modify `packages/core/src/config/config.schema.spec.ts`:

1. Заменить спек `rejects REFRESH_TOKEN_TTL > GUEST_TTL (REQ-ID-016)` на:

```ts
  it('accepts REFRESH_TOKEN_TTL > GUEST_TTL (guest cap применяется при выдаче, не в конфиге; design §5)', () => {
    const cfg = loadConfig({ ...base, GUEST_TTL: '86400', REFRESH_TOKEN_TTL: '2592000' } as NodeJS.ProcessEnv);
    expect(cfg.REFRESH_TOKEN_TTL).toBe(2_592_000);
  });

  it('rejects REFRESH_TOKEN_TTL below 1 day / above 90 days (§4)', () => {
    expect(() => loadConfig({ ...base, REFRESH_TOKEN_TTL: '3600' } as NodeJS.ProcessEnv)).toThrow(/REFRESH_TOKEN_TTL/);
    expect(() => loadConfig({ ...base, REFRESH_TOKEN_TTL: '8000000' } as NodeJS.ProcessEnv)).toThrow(/REFRESH_TOKEN_TTL/);
  });
```

2. Спек дефолта (бывш. `86400`): `expect(cfg.REFRESH_TOKEN_TTL).toBe(2_592_000);`

3. Новые спеки Google-секции:

```ts
  it('accepts absent Google section (optional, design §8)', () => {
    const cfg = loadConfig(base as NodeJS.ProcessEnv);
    expect(cfg.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(cfg.OAUTH_REDIRECT_ALLOWLIST).toEqual([]);
    expect(cfg.OAUTH_STATE_TTL).toBe(600);
    expect(cfg.OAUTH_RATE_LIMIT).toBe(10);
  });

  it('rejects partial Google section (all-or-none, REQ-OPS-003)', () => {
    expect(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: 'id' } as NodeJS.ProcessEnv)).toThrow(/GOOGLE/);
    expect(() =>
      loadConfig({ ...base, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' } as NodeJS.ProcessEnv),
    ).toThrow(/GOOGLE/);
  });

  it('requires non-empty OAUTH_REDIRECT_ALLOWLIST when Google is configured (REQ-ID-009)', () => {
    expect(() =>
      loadConfig({
        ...base,
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 's',
        OAUTH_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
      } as NodeJS.ProcessEnv),
    ).toThrow(/OAUTH_REDIRECT_ALLOWLIST/);
  });

  it('parses full Google section and allowlist transform', () => {
    const cfg = loadConfig({
      ...base,
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 's',
      OAUTH_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
      OAUTH_REDIRECT_ALLOWLIST: 'http://localhost:3000/app, http://localhost:3000/other',
    } as NodeJS.ProcessEnv);
    expect(cfg.OAUTH_REDIRECT_ALLOWLIST).toEqual(['http://localhost:3000/app', 'http://localhost:3000/other']);
  });
```

- [ ] **Step 2: Run — убедиться, что падают**

Run: `pnpm --filter @mymozhem/core test -t "config"` — фильтр матчит >0; новые спеки FAIL.

- [ ] **Step 3: Реализация**

Modify `packages/core/src/config/config.schema.ts`:

1. Заменить строку `REFRESH_TOKEN_TTL`:

```ts
  // §4: refresh_token_ttl — 30 сут, 1 сут … 90 сут (секунды). Гостевой cap
  // (≤ guest_ttl, REQ-ID-016) применяется в точках выдачи (TokenService.sessionExpiry,
  // setRefreshCookie), не здесь: инвариант REQ-ID-016 — про гостевой refresh,
  // не про глобальный параметр (design 2026-09-02 §5/§8).
  REFRESH_TOKEN_TTL: z.coerce.number().int().min(86_400).max(7_776_000).default(2_592_000),
```

2. После `CORS_ORIGINS` добавить:

```ts
  // REQ-ID-015/009: Google OAuth — опциональная секция, all-or-none (superRefine ниже).
  // Без неё приложение бутится, эндпоинты /auth/google* отдают OAUTH_NOT_CONFIGURED.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  OAUTH_REDIRECT_URI: z.url().optional(),
  OAUTH_REDIRECT_ALLOWLIST: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url())),
  // TTL state/PKCE/redirect кук OAuth-флоу (секунды).
  OAUTH_STATE_TTL: z.coerce.number().int().min(60).max(1800).default(600),
  // REQ-SEC-007 (§4 login_rate_limit): /auth/google и /auth/google/callback, 10/мин на IP.
  OAUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
```

3. В `superRefine` удалить блок `REFRESH_TOKEN_TTL > GUEST_TTL` (первый if) и добавить в конец:

```ts
    const googleSet = [cfg.GOOGLE_CLIENT_ID, cfg.GOOGLE_CLIENT_SECRET, cfg.OAUTH_REDIRECT_URI];
    const googlePresent = googleSet.filter((v) => v !== undefined).length;
    if (googlePresent > 0 && googlePresent < 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message: 'Google OAuth is all-or-none: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_REDIRECT_URI (REQ-ID-015)',
      });
    }
    if (googlePresent === 3 && cfg.OAUTH_REDIRECT_ALLOWLIST.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['OAUTH_REDIRECT_ALLOWLIST'],
        message: 'OAUTH_REDIRECT_ALLOWLIST must be non-empty when Google OAuth is configured (REQ-ID-009)',
      });
    }
```

- [ ] **Step 4: TEST_CONFIG**

Modify `packages/core/src/testing/test-config.ts` — обновить комментарий и значения:

```ts
  REFRESH_TOKEN_TTL: 2_592_000,
  OAUTH_STATE_TTL: 600,
  OAUTH_RATE_LIMIT: 10,
  OAUTH_REDIRECT_ALLOWLIST: [],
```

(Опциональные GOOGLE_*/OAUTH_REDIRECT_URI отсутствуют — валидно; REFRESH_TOKEN_TTL поднят до нового дефолта, чтобы registered-ветки int-спеков Task 4 видели TTL > GUEST_TTL.)

- [ ] **Step 5: Run**

Run: `pnpm --filter @mymozhem/core test -t "config"` → PASS; затем полный `pnpm --filter @mymozhem/core test` → зелёный (спеки, читавшие старый инвариант, уже правлены в Step 1; иные падения — чинить здесь).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config packages/core/src/testing/test-config.ts
git commit -m "feat(core): конфиг — опциональная Google-секция all-or-none, REFRESH_TOKEN_TTL к §4 пакета (REQ-OPS-003, REQ-ID-009)"
```

---

### Task 3: Prisma — миграция oauth_identity_provider

**Files:**
- Modify: `packages/core/prisma/schema.prisma`
- Create: `packages/core/prisma/migrations/<timestamp>_oauth_identity_provider/migration.sql`
- Create: `packages/core/src/identity/identity-provider-schema.int-spec.ts`

**Interfaces:**
- Produces: таблица `identity."IdentityProvider"` (unique(provider,subject), index(identityId), FK→Identity RESTRICT); Prisma-клиент `identityProvider` с compound-where `provider_subject`. Потребители: `IdentityService.findOrCreateByProvider` (Task 5).

- [ ] **Step 1: Схема**

Modify `packages/core/prisma/schema.prisma` — на модель `Identity` добавить релейшн `providers IdentityProvider[]` (после `sessions Session[]`) и новую модель после `Session`:

```prisma
// IdentityProvider — provider-данные REGISTERED (REQ-ID-015): отдельная таблица,
// PII (REQ-SEC-004). 'google' — единственный провайдер MVP; enum не вводится —
// второй провайдер = данные, не миграция. onDelete: Restrict — удаления нет,
// есть анонимизация (REQ-ID-014); чистка при анонимизации REGISTERED — шов (design §10).
model IdentityProvider {
  id         String   @id @default(uuid()) @db.Uuid
  identityId String   @db.Uuid
  provider   String
  subject    String
  email      String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  identity   Identity @relation(fields: [identityId], references: [id], onDelete: Restrict)

  @@unique([provider, subject])
  @@index([identityId])
  @@schema("identity")
}
```

- [ ] **Step 2: Миграция (authoring-контейнер, паттерн HANDOFF)**

```bash
docker run -d --name mm-migrate-oauth -e POSTGRES_PASSWORD=postgres -p 55434:5432 postgres:17
# дождаться готовности: pg_isready или 3-5 с
DATABASE_URL="postgresql://postgres:postgres@localhost:55434/postgres" pnpm exec prisma migrate dev --name oauth_identity_provider
docker rm -f mm-migrate-oauth
```

Проверить сгенерированный `migration.sql` глазами: схема `identity.`, unique index `"IdentityProvider_provider_subject_key"`, index `"IdentityProvider_identityId_idx"`, FK `ON DELETE RESTRICT` (НЕ Cascade/SetNull — при расхождении править SQL руками до apply, прецедент рукописных правок есть). Если `migrate dev` не регенерировал клиент: `DATABASE_URL="postgresql://postgres:postgres@localhost:55434/postgres" pnpm exec prisma generate` ДО удаления контейнера (HANDOFF: generate требует DATABASE_URL, cwd = корень).

- [ ] **Step 3: Падающий int-спек наличия (REQ-DEV-006 конвенция)**

Create `packages/core/src/identity/identity-provider-schema.int-spec.ts` по паттерну `identity-schema.int-spec.ts`:

```ts
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';

describe('identity."IdentityProvider" schema (REQ-ID-015, REQ-DEV-006 автотест наличия)', () => {
  let db: TestDb;
  beforeAll(async () => { db = await startTestDb(); }, 120000);
  afterAll(async () => { await db.stop(); });

  it('exists with unique(provider, subject), index(identityId), FK Restrict', async () => {
    const tables = await db.prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'identity' AND tablename = 'IdentityProvider'
    `;
    expect(tables).toHaveLength(1);

    const indexes = await db.prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'identity' AND tablename = 'IdentityProvider'
    `;
    const unique = indexes.find((i) => i.indexname === 'IdentityProvider_provider_subject_key');
    expect(unique?.indexdef).toMatch(/^CREATE UNIQUE INDEX/);
    expect(indexes.some((i) => i.indexname === 'IdentityProvider_identityId_idx')).toBe(true);

    const fks = await db.prisma.$queryRaw<{ pg_get_constraintdef: string }[]>`
      SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conrelid = 'identity."IdentityProvider"'::regclass AND contype = 'f'
    `;
    expect(fks).toHaveLength(1);
    expect(fks[0].pg_get_constraintdef).toContain('REFERENCES identity."Identity"(id)');
    expect(fks[0].pg_get_constraintdef).toContain('ON DELETE RESTRICT');
  });
});
```

- [ ] **Step 4: Run**

Run: `pnpm --filter @mymozhem/core test:int -t "IdentityProvider"` — матчей >0, PASS (миграция уже применена testcontainer'ом из каталога миграций; до Step 2 спек был бы красным на `pg_tables`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/prisma packages/core/src/identity/identity-provider-schema.int-spec.ts
git commit -m "feat(core): миграция oauth_identity_provider — таблица IdentityProvider (REQ-ID-015)"
```

---

### Task 4: TokenService — kind-aware TTL + issueRegisteredTokens; кука по kind

**Files:**
- Modify: `packages/core/src/auth/token.service.ts`
- Modify: `packages/core/src/auth/token.service.spec.ts`
- Modify: `packages/core/src/auth/token.service.int-spec.ts`
- Modify: `packages/core/src/transport/refresh-cookie.ts`
- Modify: `packages/core/src/transport/join.controller.ts` (вызов куки с `issued.kind`)
- Modify: `packages/core/src/transport/auth.controller.ts` (вызов куки с `issued.kind`)

**Interfaces:**
- Produces: `IssuedTokens { accessToken, expiresIn, refreshToken, kind: 'GUEST' | 'REGISTERED' }`; `TokenService.issueRegisteredTokens(identityId: string): Promise<IssuedTokens>` (claims `{sub, sid, kind:'REGISTERED'}` БЕЗ roomId, session TTL = REFRESH_TOKEN_TTL); `sessionExpiry(kind: 'GUEST' | 'REGISTERED'): Date`; `setRefreshCookie(reply, refreshToken, config, kind: 'GUEST' | 'REGISTERED')` (maxAge: GUEST → min(REFRESH,GUEST_TTL), REGISTERED → REFRESH_TOKEN_TTL). Потребители: OAuthService (Task 6), OAuthController/JoinController/AuthController (Task 7, здесь — два существующих).
- Consumes: `AppConfig` (Task 2 — REFRESH_TOKEN_TTL уже без гостевого cap в TEST_CONFIG).

- [ ] **Step 1: Падающие unit-спеки**

Modify `packages/core/src/auth/token.service.spec.ts`:

1. Существующий спек `caps session expiry by min(...)` — пометить `(GUEST-ветка)`; он остаётся валидным.
2. Новые спеки:

```ts
  it('issueGuestTokens returns kind GUEST', async () => {
    const issued = await service.issueGuestTokens('id-1', 'room-1');
    expect(issued.kind).toBe('GUEST');
  });

  it('issueRegisteredTokens: claims без roomId, TTL без guest-cap (REQ-ID-016 REGISTERED-ветка)', async () => {
    const issued = await service.issueRegisteredTokens('id-registered');
    expect(issued.kind).toBe('REGISTERED');
    const claims = service.verifyAccessToken(issued.accessToken);
    expect(claims.kind).toBe('REGISTERED');
    expect(claims.roomId).toBeUndefined();
    // TEST_CONFIG: REFRESH_TOKEN_TTL (30 сут) > GUEST_TTL (1 сут) — registered не наследует cap.
    const session = await prisma.session.findFirstOrThrow({ where: { identityId: 'id-registered' } });
    const expectedMs = TEST_CONFIG.REFRESH_TOKEN_TTL * 1000;
    expect(Math.abs(session.expiresAt.getTime() - (Date.now() + expectedMs))).toBeLessThan(5_000);
  });
```

(Спек использует те же mock-фикстуры prisma, что существующие — посмотреть текущий стиль мока в файле и повторить: unit-спек token.service мокает `prisma.session.create`/`findFirstOrThrow` по месту; если моки — jest-фейки объекта, добавить `session.findFirstOrThrow` в фейк.)

3. Спек ротации: зарегистрированная identity (`kind: 'REGISTERED'`) проходит rotate → новая сессия `expiresAt ≈ now + REFRESH_TOKEN_TTL` (не min), `issued.kind === 'REGISTERED'`, roomId отсутствует.

- [ ] **Step 2: Падающий int-спек ротации REGISTERED**

Modify `packages/core/src/auth/token.service.int-spec.ts` — новый кейс: seed REGISTERED identity → `issueRegisteredTokens` → `rotate(refreshToken)` → новая сессия `expiresAt > now + GUEST_TTL*1000` (гостевой cap не наследуется), `kind: 'REGISTERED'` в claims, `roomId === undefined`; reuse-detection старого токена гасит семейство (повторное предъявление → SESSION_INVALID) — REQ-ID-007 работает и для REGISTERED.

- [ ] **Step 3: Run — убедиться, что падают**

Run: `pnpm --filter @mymozhem/core test -t "TokenService"` → новые FAIL (метода нет); int пока не запускать.

- [ ] **Step 4: Реализация token.service.ts**

1. `IssuedTokens` += `kind: 'GUEST' | 'REGISTERED';`
2. `issueGuestTokens` — тело выдачи выносится в приватный `issue(identityId, kind, roomId?)`; гостевой вызов — `this.issue(identityId, 'GUEST', roomId)`; expiresAt — `this.sessionExpiry(kind)`; возврат включает `kind`.
3. Новый публичный:

```ts
  // REGISTERED-выдача (OAuth-срез, REQ-ID-015/016): без roomId-scope, TTL без guest-cap.
  async issueRegisteredTokens(identityId: string): Promise<IssuedTokens> {
    return this.issue(identityId, 'REGISTERED');
  }
```

4. `sessionExpiry`:

```ts
  // Одна норма в двух местах (design §5): GUEST → min(REFRESH, GUEST_TTL),
  // REGISTERED → REFRESH_TOKEN_TTL. Парное место — maxAge в setRefreshCookie; менять вместе.
  protected sessionExpiry(kind: 'GUEST' | 'REGISTERED'): Date {
    const ttl = kind === 'GUEST'
      ? Math.min(this.config.REFRESH_TOKEN_TTL, this.config.GUEST_TTL)
      : this.config.REFRESH_TOKEN_TTL;
    return new Date(Date.now() + ttl * 1000);
  }
```

5. В `rotate`: создание новой сессии — `expiresAt: this.sessionExpiry(identity.kind)`; возврат — `kind: identity.kind` в `IssuedTokens` и в claims (claims уже берут `identity.kind`).

- [ ] **Step 5: Реализация куки + вызовы**

Modify `packages/core/src/transport/refresh-cookie.ts`:

```ts
// maxAge повторяет sessionExpiry (design §5 — одна норма в двух местах, менять вместе):
// GUEST → min(REFRESH, GUEST_TTL) (REQ-ID-016); REGISTERED → REFRESH_TOKEN_TTL.
export function setRefreshCookie(
  reply: ReplyLike,
  refreshToken: string,
  config: AppConfig,
  kind: 'GUEST' | 'REGISTERED',
): void {
  const maxAge = kind === 'GUEST' ? Math.min(config.REFRESH_TOKEN_TTL, config.GUEST_TTL) : config.REFRESH_TOKEN_TTL;
  void reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/auth',
    maxAge,
  });
}
```

Вызовы: `join.controller.ts` — `setRefreshCookie(reply, issued.refreshToken, this.config, issued.kind)`; `auth.controller.ts` (refresh) — то же с `issued.kind`.

- [ ] **Step 6: Run**

Run: `pnpm --filter @mymozhem/core test -t "TokenService"` → PASS; `pnpm --filter @mymozhem/core test` → зелёный; `pnpm --filter @mymozhem/core test:int -t "TokenService"` → PASS (матчей >0).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/auth packages/core/src/transport/refresh-cookie.ts packages/core/src/transport/join.controller.ts packages/core/src/transport/auth.controller.ts
git commit -m "feat(core): REGISTERED-выдача токенов без guest-cap — sessionExpiry/cookie по kind (REQ-ID-016, design §5)"
```

---

### Task 5: IdentityService.findOrCreateByProvider

**Files:**
- Create: `packages/core/src/identity/identity.errors.ts`
- Modify: `packages/core/src/identity/identity.service.ts`
- Create: `packages/core/src/identity/identity-provisioning.int-spec.ts`

**Interfaces:**
- Produces: `IdentityError` + `IDENTITY_ERROR_CODES { EMAIL_CONFLICT, PROVIDER_IDENTITY_GONE }`; `IdentityService.findOrCreateByProvider(input: { provider: string; subject: string; email: string; displayName?: string | undefined }): Promise<Identity>` — self-contained транзакция (без tx-параметра: retry при гонке несовместим с чужой транзакцией). Потребитель: OAuthService (Task 6) — переводит `EMAIL_CONFLICT` → `OAUTH_EMAIL_CONFLICT`; `PROVIDER_IDENTITY_GONE` не переводится (недостижимо в MVP, фильтр → INTERNAL_ERROR с логом, design §4).
- Consumes: `prisma.identityProvider` (Task 3), `displayNameSchema` (SDK).

- [ ] **Step 1: Падающий int-спек**

Create `packages/core/src/identity/identity-provisioning.int-spec.ts` — сервис конструируется напрямую: `new IdentityService(db.prisma)` (прецедент `identity.service.int-spec.ts`). Кейсы:

1. **Создание:** `findOrCreateByProvider({ provider: 'google', subject: 'sub-1', email: 'a@b.c', displayName: 'Alex' })` → identity `{ kind: 'REGISTERED', email: 'a@b.c', displayName: 'Alex' }`; строка IdentityProvider на месте (`provider, subject, email, identityId`).
2. **Повторный логин:** тот же sub, но другой email (`'new@b.c'`) → та же identity, email НЕ перезаписан (решение владельца §0.3).
3. **Email-конфликт:** seedIdentity `{ kind: 'REGISTERED', email: 'Taken@b.c' }` → вызов с `email: 'taken@b.c'` (другой регистр!) → `IdentityError` с кодом `EMAIL_CONFLICT` (case-insensitive, partial index на lower(email)).
4. **Гость с тем же email — не конфликт:** seedIdentity `{ kind: 'GUEST', email: 'g@b.c' }` → создание REGISTERED с `g@b.c` проходит (partial index — только REGISTERED).
5. **Гонка:** `Promise.allSettled([два вызова с одним sub параллельно])` → оба resolved, одинаковый identity.id, в БД одна identity + одна provider-строка.
6. **displayName fallback:** `displayName: 'x'.repeat(41)` → identity создана с `displayName: null`.
7. **deletedAt fail-closed:** вызов 1 создаёт; вручную `identity.update({ deletedAt: new Date() })`; повторный вызов → `IdentityError` `PROVIDER_IDENTITY_GONE`.

- [ ] **Step 2: Run — убедиться, что падают**

Run: `pnpm --filter @mymozhem/core test:int -t "findOrCreateByProvider"` — матчей >0, FAIL (метода нет).

- [ ] **Step 3: Реализация**

Create `packages/core/src/identity/identity.errors.ts`:

```ts
// Core-internal ошибки identity-потоков (REQ-ID-015 provisioning). Wire-маппинг —
// через вызывающий сервис (OAuthService, design §4/§7), а не напрямую в фильтр.
export const IDENTITY_ERROR_CODES = {
  EMAIL_CONFLICT: 'EMAIL_CONFLICT',
  PROVIDER_IDENTITY_GONE: 'PROVIDER_IDENTITY_GONE',
} as const;
export type IdentityErrorCode = (typeof IDENTITY_ERROR_CODES)[keyof typeof IDENTITY_ERROR_CODES];

export class IdentityError extends Error {
  constructor(readonly code: IdentityErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
  }
}
```

Modify `packages/core/src/identity/identity.service.ts` — добавить метод:

```ts
  // REQ-ID-015: логин/регистрация по (provider, subject). Self-contained транзакция:
  // retry при гонке несовместим с чужой (поэтому без tx-параметра, в отличие от createGuest).
  // Email-политика (решение владельца, design §0.3): email пишется один раз при создании,
  // автолинка по email НЕТ — конфликт с живым REGISTERED → EMAIL_CONFLICT.
  //
  // Инвариант «change both or neither» (теперь трёх мест): предикат
  // kind='REGISTERED' AND deletedAt IS NULL — partial index "Identity_registered_email_key",
  // guarded INSERT RoomService.create и проверка конфликта ниже. Менять только вместе.
  async findOrCreateByProvider(input: {
    provider: string;
    subject: string;
    email: string;
    displayName?: string | undefined;
  }): Promise<Identity> {
    const where = { provider_subject: { provider: input.provider, subject: input.subject } };
    const existing = await this.prisma.identityProvider.findUnique({ where, include: { identity: true } });
    if (existing) {
      if (existing.identity.deletedAt !== null) {
        throw new IdentityError(IDENTITY_ERROR_CODES.PROVIDER_IDENTITY_GONE, `identity ${existing.identityId} deleted`);
      }
      return existing.identity;
    }
    const conflict = await this.prisma.identity.findFirst({
      where: { kind: 'REGISTERED', deletedAt: null, email: { equals: input.email, mode: 'insensitive' } },
    });
    if (conflict) {
      throw new IdentityError(IDENTITY_ERROR_CODES.EMAIL_CONFLICT, `email taken by identity ${conflict.id}`);
    }
    const parsedName = input.displayName === undefined ? null : displayNameSchema.safeParse(input.displayName);
    const displayName = parsedName === null ? null : parsedName.success ? parsedName.data : null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const identity = await tx.identity.create({
          data: { kind: 'REGISTERED', email: input.email, displayName },
        });
        await tx.identityProvider.create({
          data: { provider: input.provider, subject: input.subject, email: input.email, identityId: identity.id },
        });
        return identity;
      });
    } catch (err) {
      // Гонка двух первых логинов одного аккаунта: проигравший ловит P2002 по
      // (provider, subject) и превращается в повторный логин (design §4).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.identityProvider.findUnique({ where, include: { identity: true } });
        if (winner) return winner.identity;
      }
      throw err;
    }
  }
```

(Импорты: `IdentityError, IDENTITY_ERROR_CODES` из `./identity.errors`; `Prisma` уже импортирован типом — расширить до value-импорта.)

- [ ] **Step 4: Run**

Run: `pnpm --filter @mymozhem/core test:int -t "findOrCreateByProvider"` → PASS; `pnpm --filter @mymozhem/core test` → зелёный.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/identity
git commit -m "feat(core): IdentityService.findOrCreateByProvider — provisioning REGISTERED по (provider, sub), fail-closed email (REQ-ID-015)"
```

---

### Task 6: OAuth-модуль — порт, OAuthService, GoogleOAuthClient

**Files:**
- Create: `packages/core/src/oauth/oauth.constants.ts`
- Create: `packages/core/src/oauth/oauth.errors.ts`
- Create: `packages/core/src/oauth/oauth-provider.client.ts`
- Create: `packages/core/src/oauth/oauth.service.ts`
- Create: `packages/core/src/oauth/oauth.service.spec.ts`
- Create: `packages/core/src/oauth/google-oauth.client.ts`
- Create: `packages/core/src/oauth/google-oauth.client.spec.ts`
- Create: `packages/core/src/oauth/oauth.module.ts`
- Modify: `packages/core/src/index.ts` (баррел: `OAuthModule`, `OAUTH_PROVIDER_CLIENT`, тип `OAuthProviderClient`/`ProviderProfile`)

**Interfaces:**
- Produces:
  - `OAUTH_STATE_COOKIE='mm_oauth_state'`, `OAUTH_PKCE_COOKIE='mm_oauth_pkce'`, `OAUTH_REDIRECT_COOKIE='mm_oauth_redirect'` (oauth.constants).
  - `OAuthError` + `OAUTH_ERROR_CODES` (7 кодов: NOT_CONFIGURED/REDIRECT_INVALID/STATE_INVALID/ACCESS_DENIED/EXCHANGE_FAILED/EMAIL_UNVERIFIED/EMAIL_CONFLICT).
  - `interface OAuthProviderClient { exchangeCode(code: string, pkceVerifier: string): Promise<ProviderProfile> }`; `ProviderProfile = { subject: string; email: string; emailVerified: boolean; displayName?: string | undefined }`; DI-токен `OAUTH_PROVIDER_CLIENT` (Symbol).
  - `OAuthService.start(redirect?: string): { authorizeUrl: string; cookies: { name: string; value: string }[] }`; `OAuthService.complete(input: { code?, state?, error?, cookies: Record<string, string|undefined> }): Promise<{ identityId: string; tokens: IssuedTokens; redirectTarget: string }>`.
  - `GoogleOAuthClient implements OAuthProviderClient` (единственный файл с fetch на Google).
  - `OAuthModule` — providers: `OAuthService`, `GoogleOAuthClient`, `{ provide: OAUTH_PROVIDER_CLIENT, useExisting: GoogleOAuthClient }`; exports: `OAuthService`, `OAUTH_PROVIDER_CLIENT`. Imports: `IdentityModule`, `AuthModule`, `ConfigModule`.
- Потребители: OAuthController + провайдинг лимитеров (Task 7), e2e override `OAUTH_PROVIDER_CLIENT` (Task 8).

- [ ] **Step 1: Падающие unit-спеки OAuthService**

Create `packages/core/src/oauth/oauth.service.spec.ts`. Конструирование напрямую (без Nest): `new OAuthService(identityFake, tokensFake, providerFake, config)`. Конфиг:

```ts
const OAUTH_CONFIG: AppConfig = {
  ...TEST_CONFIG,
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  OAUTH_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
  OAUTH_REDIRECT_ALLOWLIST: ['http://localhost:3000/app', 'http://localhost:3000/other'],
};
```

Кейсы `start`:
1. URL: `https://accounts.google.com/o/oauth2/v2/auth?...` — содержит `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email profile`, `code_challenge_method=S256`; `state` из query === значению куки `mm_oauth_state`; `code_challenge` === base64url(sha256(verifier из `mm_oauth_pkce`)) — пересчитать в спеке через `createHash`.
2. redirect из allowlist → кука `mm_oauth_redirect` = он; redirect отсутствует → первый элемент allowlist; redirect вне allowlist → `OAuthError OAUTH_REDIRECT_INVALID`.
3. Без Google-секции (TEST_CONFIG as-is) → `OAUTH_NOT_CONFIGURED`.

Кейсы `complete` (providerFake: `{ exchangeCode: jest.fn() }`, identityFake: `{ findOrCreateByProvider: jest.fn() }`, tokensFake: `{ issueRegisteredTokens: jest.fn().mockResolvedValue({ accessToken: 'a', expiresIn: 900, refreshToken: 'r', kind: 'REGISTERED' }) }`):
4. Happy path: cookies `{mm_oauth_state: 'S', mm_oauth_pkce: 'V', mm_oauth_redirect: allowlisted}` + input `{code: 'c', state: 'S'}` → exchangeCode вызван с `('c','V')`; profile `{subject:'sub',email:'a@b.c',emailVerified:true,displayName:'Alex'}` → findOrCreateByProvider с `{provider:'google', subject:'sub', email:'a@b.c', displayName:'Alex'}`; issueRegisteredTokens с identity.id; result.redirectTarget === кука redirect.
5. `error: 'access_denied'` → `OAUTH_ACCESS_DENIED`.
6. state не совпал / state-кука отсутствует / code отсутствует / pkce-кука отсутствует → `OAUTH_STATE_INVALID` (4 подкейса).
7. redirect-кука подменена на не-allowlist (кука httpOnly, но не подписана — перепроверка на complete, design §3) → `OAUTH_REDIRECT_INVALID`.
8. `emailVerified: false` → `OAUTH_EMAIL_UNVERIFIED`.
9. provider бросает → `OAUTH_EXCHANGE_FAILED`.
10. identity бросает `IdentityError(EMAIL_CONFLICT)` → `OAUTH_EMAIL_CONFLICT`; бросает `IdentityError(PROVIDER_IDENTITY_GONE)` → пробрасывается как есть (НЕ OAuthError).

- [ ] **Step 2: Падающий unit-спек GoogleOAuthClient**

Create `packages/core/src/oauth/google-oauth.client.spec.ts`: `jest.spyOn(globalThis, 'fetch')` → два ответа (token endpoint `{ access_token: 'at' }`, userinfo `{ sub: 'sub-1', email: 'a@b.c', email_verified: true, name: 'Alex' }`). Ассерты: первый вызов — POST `https://oauth2.googleapis.com/token`, body (URLSearchParams) содержит `code`, `code_verifier`, `client_id`, `grant_type=authorization_code`; второй — GET userinfo с `authorization: Bearer at`; результат — `ProviderProfile` с camelCase-маппингом. Негативные: token endpoint `ok: false` → throw; userinfo без `email_verified` → `emailVerified === false` (default fail-closed).

- [ ] **Step 3: Run — убедиться, что падают**

Run: `pnpm --filter @mymozhem/core test -t "OAuth"` — матчей >0, FAIL (файлов нет).

- [ ] **Step 4: Реализация**

`oauth.constants.ts` — три имени кук. `oauth.errors.ts` — по паттерну `auth.errors.ts` (7 кодов). `oauth-provider.client.ts`:

```ts
// Порт OAuth-провайдера (design §2): второй провайдер = новая реализация + данные,
// без изменений схемы/контракта. DI-токен — прецедент REFRESH_RATE_LIMITER.
export interface ProviderProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName?: string | undefined;
}

export interface OAuthProviderClient {
  exchangeCode(code: string, pkceVerifier: string): Promise<ProviderProfile>;
}

export const OAUTH_PROVIDER_CLIENT = Symbol('OAUTH_PROVIDER_CLIENT');
```

`oauth.service.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Identity } from '@prisma/client';
import { IdentityService } from '../identity/identity.service';
import { IdentityError, IDENTITY_ERROR_CODES } from '../identity/identity.errors';
import { TokenService, type IssuedTokens } from '../auth/token.service';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { OAUTH_ERROR_CODES, OAuthError } from './oauth.errors';
import { OAUTH_PKCE_COOKIE, OAUTH_REDIRECT_COOKIE, OAUTH_STATE_COOKIE } from './oauth.constants';
import { OAUTH_PROVIDER_CLIENT, type OAuthProviderClient } from './oauth-provider.client';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export interface OAuthStartResult {
  authorizeUrl: string;
  cookies: { name: string; value: string }[];
}

export interface OAuthCompleteInput {
  code?: string | undefined;
  state?: string | undefined;
  error?: string | undefined;
  cookies: Record<string, string | undefined>;
}

export interface OAuthCompleteResult {
  identityId: string;
  tokens: IssuedTokens;
  redirectTarget: string;
}

@Injectable()
export class OAuthService {
  constructor(
    private readonly identity: IdentityService,
    private readonly tokens: TokenService,
    @Inject(OAUTH_PROVIDER_CLIENT) private readonly provider: OAuthProviderClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // REQ-ID-009: state — double-submit (nonce в httpOnly-куке === state в query),
  // PKCE S256; redirect — только из allowlist, перепроверяется и на complete.
  start(redirect?: string): OAuthStartResult {
    const cfg = this.googleConfig();
    const target = this.validateRedirect(redirect);
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const url = new URL(GOOGLE_AUTHORIZE_URL);
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', cfg.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', nonce);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return {
      authorizeUrl: url.toString(),
      cookies: [
        { name: OAUTH_STATE_COOKIE, value: nonce },
        { name: OAUTH_PKCE_COOKIE, value: verifier },
        { name: OAUTH_REDIRECT_COOKIE, value: target },
      ],
    };
  }

  async complete(input: OAuthCompleteInput): Promise<OAuthCompleteResult> {
    this.googleConfig();
    if (input.error !== undefined) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_ACCESS_DENIED, `google error: ${input.error}`);
    }
    const stateCookie = input.cookies[OAUTH_STATE_COOKIE];
    if (!stateCookie || !input.state || input.state !== stateCookie || !input.code) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_STATE_INVALID, 'state mismatch or code missing');
    }
    const verifier = input.cookies[OAUTH_PKCE_COOKIE];
    const redirectCookie = input.cookies[OAUTH_REDIRECT_COOKIE];
    if (!verifier || !redirectCookie) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_STATE_INVALID, 'oauth cookies missing');
    }
    // Кука httpOnly, но не подписана — allowlist перепроверяется и здесь (design §3).
    const redirectTarget = this.validateRedirect(redirectCookie);
    let profile: ProviderProfile;
    try {
      profile = await this.provider.exchangeCode(input.code, verifier);
    } catch (err) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_EXCHANGE_FAILED, `code exchange failed: ${(err as Error).message}`);
    }
    if (profile.emailVerified !== true) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_EMAIL_UNVERIFIED, `email not verified (sub ${profile.subject})`);
    }
    let identity: Identity;
    try {
      identity = await this.identity.findOrCreateByProvider({
        provider: 'google',
        subject: profile.subject,
        email: profile.email,
        displayName: profile.displayName,
      });
    } catch (err) {
      if (err instanceof IdentityError && err.code === IDENTITY_ERROR_CODES.EMAIL_CONFLICT) {
        throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_EMAIL_CONFLICT, err.message);
      }
      throw err;
    }
    const tokens = await this.tokens.issueRegisteredTokens(identity.id);
    return { identityId: identity.id, tokens, redirectTarget };
  }

  private googleConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_REDIRECT_URI } = this.config;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !OAUTH_REDIRECT_URI) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_NOT_CONFIGURED, 'google oauth not configured');
    }
    return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: OAUTH_REDIRECT_URI };
  }

  private validateRedirect(target?: string): string {
    if (target === undefined) {
      const fallback = this.config.OAUTH_REDIRECT_ALLOWLIST[0];
      if (!fallback) {
        throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_NOT_CONFIGURED, 'redirect allowlist empty');
      }
      return fallback;
    }
    if (!this.config.OAUTH_REDIRECT_ALLOWLIST.includes(target)) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_REDIRECT_INVALID, 'redirect target not in allowlist');
    }
    return target;
  }
}
```

`google-oauth.client.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { OAUTH_ERROR_CODES, OAuthError } from './oauth.errors';
import type { OAuthProviderClient, ProviderProfile } from './oauth-provider.client';

// Единственный файл с сетевым кодом Google (design §2). Сырые ответы — loose-схемы:
// лишние поля Google нам безразличны, обязательные — fail-closed.
const googleTokenResponseSchema = z.looseObject({ access_token: z.string().min(1) });
const googleUserinfoSchema = z.looseObject({
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.boolean().default(false), // default — fail-closed к «не verified»
  name: z.string().optional(),
});

@Injectable()
export class GoogleOAuthClient implements OAuthProviderClient {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async exchangeCode(code: string, pkceVerifier: string): Promise<ProviderProfile> {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_REDIRECT_URI } = this.config;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !OAUTH_REDIRECT_URI) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_NOT_CONFIGURED, 'google oauth not configured');
    }
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: OAUTH_REDIRECT_URI,
        grant_type: 'authorization_code',
        code_verifier: pkceVerifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) throw new Error(`google token endpoint: ${tokenRes.status}`);
    const tokenBody = googleTokenResponseSchema.parse(await tokenRes.json());
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tokenBody.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!infoRes.ok) throw new Error(`google userinfo: ${infoRes.status}`);
    const info = googleUserinfoSchema.parse(await infoRes.json());
    return { subject: info.sub, email: info.email, emailVerified: info.email_verified, displayName: info.name };
  }
}
```

`oauth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { IdentityModule } from '../identity/identity.module';
import { AuthModule } from '../auth/auth.module';
import { OAuthService } from './oauth.service';
import { GoogleOAuthClient } from './google-oauth.client';
import { OAUTH_PROVIDER_CLIENT } from './oauth-provider.client';

@Module({
  imports: [ConfigModule, IdentityModule, AuthModule],
  providers: [
    OAuthService,
    GoogleOAuthClient,
    // Порт → Google-реализация; в e2e подменяется override'ом токена (design §9).
    { provide: OAUTH_PROVIDER_CLIENT, useExisting: GoogleOAuthClient },
  ],
  exports: [OAuthService, OAUTH_PROVIDER_CLIENT],
})
export class OAuthModule {}
```

Баррел `packages/core/src/index.ts`: экспорт `OAuthModule` (из `./oauth/oauth.module`), `OAUTH_PROVIDER_CLIENT`, типов `OAuthProviderClient`, `ProviderProfile` (из `./oauth/oauth-provider.client`).

- [ ] **Step 5: Run**

Run: `pnpm --filter @mymozhem/core test -t "OAuth"` → PASS; `pnpm --filter @mymozhem/core test` → зелёный; `pnpm --filter @mymozhem/core build` → зелёный (баррел).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/oauth packages/core/src/index.ts
git commit -m "feat(core): OAuth-модуль — порт провайдера, OAuthService (state+PKCE+allowlist), GoogleOAuthClient (REQ-ID-015/009)"
```

---

### Task 7: Transport — OAuth-эндпоинты, POST /rooms, ветки фильтра

**Files:**
- Modify: `packages/core/src/transport/http.types.ts`
- Create: `packages/core/src/transport/authenticate.ts`
- Modify: `packages/core/src/transport/exclude.controller.ts` (переход на общий `authenticate`)
- Modify: `packages/core/src/transport/auth.tokens.ts`
- Create: `packages/core/src/transport/oauth.controller.ts`
- Create: `packages/core/src/transport/rooms.controller.ts`
- Modify: `packages/core/src/transport/http-exception.filter.ts`
- Modify: `packages/core/src/transport/http-exception.filter.spec.ts`
- Modify: `packages/core/src/transport/transport.module.ts`

**Interfaces:**
- Consumes: `OAuthService` (Task 6), `issueRegisteredTokens`-ветка `IssuedTokens.kind` (Task 4), SDK-схемы Task 1, `OAUTH_RATE_LIMIT` из конфига (Task 2), `RoomService.create(organizerId, joinPolicy)` — существующий.
- Produces: `authenticate(req: RequestLike, tokens: TokenService): AccessClaims` (общий helper); `OAUTH_START_RATE_LIMITER`, `OAUTH_CALLBACK_RATE_LIMITER` (Symbol); эндпоинты `GET /auth/google`, `GET /auth/google/callback`, `POST /rooms`; `ReplyLike` += `clearCookie(name, {path})`, `redirect(statusCode, url)`, `sameSite: 'strict' | 'lax'`; фильтр: ветки `OAuthError` (per-code) и `RoomError` (частичная таблица).

- [ ] **Step 1: Падающие спеки фильтра**

Modify `packages/core/src/transport/http-exception.filter.spec.ts` — таблица маппинга (стиль существующих кейсов): `OAuthError` по каждому из 7 кодов → wire тот же код, статусы `OAUTH_NOT_CONFIGURED→503, OAUTH_REDIRECT_INVALID→400, OAUTH_STATE_INVALID→401, OAUTH_ACCESS_DENIED→403, OAUTH_EXCHANGE_FAILED→502, OAUTH_EMAIL_UNVERIFIED→403, OAUTH_EMAIL_CONFLICT→409`; `RoomOrganizerNotRegisteredError` → 403 `ROOM_ORGANIZER_NOT_REGISTERED`; другой `RoomError` (напр. `RoomTransitionError`) → 500 `INTERNAL_ERROR`; тело всех ответов — ровно `{code}` (REQ-SEC-006).

- [ ] **Step 2: Run — убедиться, что падают**

Run: `pnpm --filter @mymozhem/core test -t "HttpExceptionFilter"` → FAIL (коды не маппятся → INTERNAL_ERROR).

- [ ] **Step 3: Реализация фильтра**

Modify `packages/core/src/transport/http-exception.filter.ts`:

1. В `STATUS_BY_WIRE_CODE` добавить (комментарий со ссылкой на design §7):

```ts
  // OAuth-срез (REQ-ID-015/009, design 2026-09-02 §7).
  OAUTH_NOT_CONFIGURED: 503,
  OAUTH_REDIRECT_INVALID: 400,
  OAUTH_STATE_INVALID: 401,
  OAUTH_ACCESS_DENIED: 403,
  OAUTH_EXCHANGE_FAILED: 502,
  OAUTH_EMAIL_UNVERIFIED: 403,
  OAUTH_EMAIL_CONFLICT: 409,
  // Первый HTTP-путь RoomError (POST /rooms, REQ-ID-005).
  ROOM_ORGANIZER_NOT_REGISTERED: 403,
```

2. В `toWireCode` после ветки `AuthError`:

```ts
    if (exception instanceof OAuthError) return exception.code;
    if (exception instanceof RoomError) {
      // Покрытие частичное (design §11): по HTTP в этом срезе достижим только
      // ROOM_ORGANIZER_NOT_REGISTERED; прочие коды — INTERNAL_ERROR с error-логом.
      return exception.code === 'ROOM_ORGANIZER_NOT_REGISTERED' ? exception.code : 'INTERNAL_ERROR';
    }
```

3. В `catch` рядом с warn-логом AuthError — аналогичный warn для `OAuthError` (message безопасен: фиксированные строки + id/sub, без токен-материала).

Импорты: `OAuthError` из `../oauth/oauth.errors`, `RoomError` из `../room/room.errors`.

- [ ] **Step 4: http.types + authenticate + exclude-переход**

Modify `http.types.ts` — `ReplyLike`:

```ts
export interface ReplyLike {
  setCookie(
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'strict' | 'lax'; // lax — oauth state/pkce/redirect (возврат с Google, design §3)
      path: string;
      maxAge: number;
    },
  ): unknown;
  // OAuth-флоу: одноразовые куки гасятся при любом исходе; 302 на Google и на цель.
  clearCookie(name: string, options: { path: string }): unknown;
  redirect(statusCode: number, url: string): unknown;
}
```

Create `packages/core/src/transport/authenticate.ts`:

```ts
import { TokenService, type AccessClaims } from '../auth/token.service';
import type { RequestLike } from './http.types';

// Bearer-аутентификация REST (первый потребитель — ExcludeController, срез исключения;
// вынос при втором — RoomsController, OAuth-срез). Невалидный/отсутствующий токен —
// AuthError SESSION_INVALID (фильтр → 401). actorId — только из токена (REQ-RT-009 по духу HTTP).
export function authenticate(req: RequestLike, tokens: TokenService): AccessClaims {
  const header = req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  return tokens.verifyAccessToken(token);
}
```

Modify `exclude.controller.ts`: удалить приватный `authenticate`, использовать общий (`const claims = authenticate(req, this.tokens);`).

Modify `auth.tokens.ts`:

```ts
// Отдельные инстансы лимитеров для OAuth-эндпоинтов (REQ-SEC-007): start и callback
// не делят состояние ни между собой, ни с join/refresh.
export const OAUTH_START_RATE_LIMITER = Symbol('OAUTH_START_RATE_LIMITER');
export const OAUTH_CALLBACK_RATE_LIMITER = Symbol('OAUTH_CALLBACK_RATE_LIMITER');
```

- [ ] **Step 5: Контроллеры**

Create `packages/core/src/transport/oauth.controller.ts`:

```ts
import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import { oauthCallbackQuerySchema, oauthStartQuerySchema } from '@mymozhem/sdk';
import { OAuthService } from '../oauth/oauth.service';
import { OAUTH_PKCE_COOKIE, OAUTH_REDIRECT_COOKIE, OAUTH_STATE_COOKIE } from '../oauth/oauth.constants';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { JoinRateLimitedError } from '../membership/membership.errors';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { OAUTH_CALLBACK_RATE_LIMITER, OAUTH_START_RATE_LIMITER } from './auth.tokens';
import { setRefreshCookie } from './refresh-cookie';
import type { ReplyLike, RequestLike } from './http.types';

// Тонкий транспорт (design §3): rate-limit → схема → сервис → куки/redirect.
// Статусов не знает — ошибки уходят в фильтр. Access-токен в URL не попадает
// (REQ-ID-008): клиент после лендинга вызывает POST /auth/refresh.
@Controller('auth')
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    @Inject(OAUTH_START_RATE_LIMITER) private readonly startLimiter: JoinRateLimiter,
    @Inject(OAUTH_CALLBACK_RATE_LIMITER) private readonly callbackLimiter: JoinRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('google')
  start(@Query() query: unknown, @Req() req: RequestLike, @Res({ passthrough: true }) reply: ReplyLike): void {
    if (!this.startLimiter.tryAcquire(req.ip)) {
      throw new JoinRateLimitedError('oauth start rate limit exceeded');
    }
    const { redirect } = oauthStartQuerySchema.parse(query ?? {});
    const result = this.oauth.start(redirect);
    for (const cookie of result.cookies) this.setOAuthCookie(reply, cookie.name, cookie.value);
    void reply.redirect(302, result.authorizeUrl);
  }

  @Get('google/callback')
  async callback(
    @Query() query: unknown,
    @Req() req: RequestLike,
    @Res({ passthrough: true }) reply: ReplyLike,
  ): Promise<void> {
    if (!this.callbackLimiter.tryAcquire(req.ip)) {
      throw new JoinRateLimitedError('oauth callback rate limit exceeded');
    }
    const q = oauthCallbackQuerySchema.parse(query ?? {});
    try {
      const result = await this.oauth.complete({
        code: q.code,
        state: q.state,
        error: q.error,
        cookies: req.cookies,
      });
      setRefreshCookie(reply, result.tokens.refreshToken, this.config, result.tokens.kind);
      this.clearOAuthCookies(reply);
      void reply.redirect(302, result.redirectTarget);
    } catch (err) {
      // Одноразовость state: куки гасятся при любом исходе (design §3).
      this.clearOAuthCookies(reply);
      throw err;
    }
  }

  private setOAuthCookie(reply: ReplyLike, name: string, value: string): void {
    void reply.setCookie(name, value, {
      httpOnly: true,
      secure: this.config.NODE_ENV === 'production',
      // Lax, не Strict: браузер обязан прислать куки на возврате с Google —
      // top-level GET-навигация (design §3, осознанное отличие от refresh-куки).
      sameSite: 'lax',
      path: '/auth',
      maxAge: this.config.OAUTH_STATE_TTL,
    });
  }

  private clearOAuthCookies(reply: ReplyLike): void {
    for (const name of [OAUTH_STATE_COOKIE, OAUTH_PKCE_COOKIE, OAUTH_REDIRECT_COOKIE]) {
      void reply.clearCookie(name, { path: '/auth' });
    }
  }
}
```

Create `packages/core/src/transport/rooms.controller.ts`:

```ts
import { Body, Controller, Post, Req } from '@nestjs/common';
import { createRoomRequestSchema, type CreateRoomResponse } from '@mymozhem/sdk';
import { RoomService } from '../room/room.service';
import { RoomOrganizerNotRegisteredError } from '../room/room.errors';
import { TokenService } from '../auth/token.service';
import { authenticate } from './authenticate';
import type { RequestLike } from './http.types';

// POST /rooms (REQ-ID-005 HTTP-путь, design §6): организатор — только REGISTERED.
// GUEST отсекается до домена тем же кодом, что DB-гейт RoomService.create.
@Controller()
export class RoomsController {
  constructor(
    private readonly rooms: RoomService,
    private readonly tokens: TokenService,
  ) {}

  @Post('rooms')
  async create(@Body() body: unknown, @Req() req: RequestLike): Promise<CreateRoomResponse> {
    const claims = authenticate(req, this.tokens);
    if (claims.kind !== 'REGISTERED') {
      throw new RoomOrganizerNotRegisteredError(`token kind ${claims.kind} cannot organize`);
    }
    const { joinPolicy } = createRoomRequestSchema.parse(body ?? {});
    const room = await this.rooms.create(claims.sub, joinPolicy);
    return { roomId: room.id, code: room.code, joinPolicy: room.joinPolicy, status: room.status };
  }
}
```

(Тип `room.status` — Prisma-enum с теми же строками, что `roomStatusSchema`; если TS не выводит совместимость — каст `room.status as CreateRoomResponse['status']`, прецедент каста на сервисной границе есть в room-state-machine.)

- [ ] **Step 6: Wiring**

Modify `transport.module.ts`: controllers += `OAuthController`, `RoomsController`; imports += `OAuthModule`, `RoomModule`; providers += две фабрики лимитеров по прецеденту REFRESH:

```ts
    {
      provide: OAUTH_START_RATE_LIMITER,
      useFactory: (config: AppConfig) => new JoinRateLimiter(config.OAUTH_RATE_LIMIT),
      inject: [APP_CONFIG],
    },
    {
      provide: OAUTH_CALLBACK_RATE_LIMITER,
      useFactory: (config: AppConfig) => new JoinRateLimiter(config.OAUTH_RATE_LIMIT),
      inject: [APP_CONFIG],
    },
```

- [ ] **Step 7: Run**

Run: `pnpm --filter @mymozhem/core test` → зелёный (фильтр-спеки PASS); `pnpm --filter @mymozhem/core build && pnpm build` → зелёный; `pnpm --filter @mymozhem/core test:int -t "TokenService"` → PASS (страховка, что wiring не сломал DI в int).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/transport packages/core/src/index.ts
git commit -m "feat(core): transport — GET /auth/google[/callback], POST /rooms, ветки фильтра OAuth/RoomError (REQ-ID-009, REQ-ID-005, REQ-SEC-007)"
```

---

### Task 8: e2e на проводе — полный флоу + негативные

**Files:**
- Create: `apps/server/test/oauth.e2e-spec.ts`

**Interfaces:**
- Consumes: всё предыдущее; `OAUTH_PROVIDER_CLIENT` из баррела core (override в Test-модуле); `seedIdentity`, `startTestDb`, `loadConfig` из `@mymozhem/core`; паттерн boot из `transport.e2e-spec.ts` (cookie/helmet/CORS, env-restore).

- [ ] **Step 1: e2e-спек**

Create `apps/server/test/oauth.e2e-spec.ts`. Скелет — по паттерну `transport.e2e-spec.ts` (`createApp(envOverrides)` зеркалит main.ts), с двумя отличиями:

```ts
const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: 'e2e-client-id',
  GOOGLE_CLIENT_SECRET: 'e2e-client-secret',
  OAUTH_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
  OAUTH_REDIRECT_ALLOWLIST: 'http://localhost:3000/app,http://localhost:3000/other',
};

const PROFILE = { subject: 'google-sub-1', email: 'org@example.test', emailVerified: true, displayName: 'Org' };

// Фейк провайдера — override DI-токена (design §9): весь флоу на проводе,
// сети нет. exchangeCode записывает аргументы для ассертов PKCE.
function createFakeProvider(profile = PROFILE) {
  return { exchangeCode: jest.fn(async (_code: string, _verifier: string) => profile) };
}

async function createApp(envOverrides: Record<string, string> = {}, provider = createFakeProvider()) {
  // ... env save/set как в transport.e2e-spec ...
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OAUTH_PROVIDER_CLIENT)
    .useValue(provider)
    .compile();
  // ... далее как в transport.e2e-spec (cookie/helmet/CORS/init/ready) ...
}
```

Кейсы:

1. **Полный флоу (критерий среза):**
   - `GET /auth/google?redirect=http://localhost:3000/app` → 302; `location` начинается с `https://accounts.google.com/o/oauth2/v2/auth?`, содержит `client_id=e2e-client-id`, `code_challenge_method=S256`; set-cookie: `mm_oauth_state`, `mm_oauth_pkce`, `mm_oauth_redirect` — все `httpOnly`, `Path=/auth`, `SameSite=Lax`.
   - Извлечь `state` из location; собрать cookie-заголовок из трёх кук.
   - `GET /auth/google/callback?code=fake-code&state=<state>` + cookie → 302 на `http://localhost:3000/app`; set-cookie `mm_refresh` (httpOnly, SameSite=Strict, maxAge ≈ 2 592 000 — **без guest-cap**, допуск ±5 с); `mm_oauth_*` — очищены (set-cookie с пустым значением/expires в прошлом).
   - `exchangeCode` фейка вызван с `('fake-code', <значение mm_oauth_pkce>)`.
   - `POST /auth/refresh` с `mm_refresh` → 200; access декодируется через `app.get(TokenService).verifyAccessToken(accessToken)` (TokenService — из баррела core, приложение уже поднято; НЕ импортировать jsonwebtoken в apps/server) → `kind: 'REGISTERED'`, `roomId` отсутствует.
   - `POST /rooms` с Bearer → 201; body по `createRoomResponseSchema`: `joinPolicy: 'guests'`, `status: 'DRAFT'`, `code` длиной ≥ 8; в БД комната принадлежит identity из access-sub.
2. **Повторный логин — та же identity:** второй полный флоу → access-sub === access-sub первого флоу.
3. **redirect вне allowlist:** `GET /auth/google?redirect=http://evil.test` → 400 `OAUTH_REDIRECT_INVALID`.
4. **state mismatch:** callback с чужим `state` → 401 `OAUTH_STATE_INVALID`; oauth-куки очищены.
5. **Нет state-куки:** callback без cookie-заголовка → 401.
6. **`error=access_denied`** → 403 `OAUTH_ACCESS_DENIED`.
7. **exchange бросает** (фейк `mockRejectedValue`) → 502 `OAUTH_EXCHANGE_FAILED`.
8. **`emailVerified: false`** → 403 `OAUTH_EMAIL_UNVERIFIED`.
9. **email-конфликт:** `seedIdentity(db.prisma, { kind: 'REGISTERED', email: 'org@example.test' })` до флоу → callback → 409 `OAUTH_EMAIL_CONFLICT`.
10. **Не сконфигурировано:** app без `GOOGLE_ENV` → `GET /auth/google` → 503 `OAUTH_NOT_CONFIGURED`.
11. **POST /rooms с GUEST-токеном:** пройти `/rooms/join` (паттерн transport.e2e) → `POST /rooms` с гостевым Bearer → 403 `ROOM_ORGANIZER_NOT_REGISTERED`.
12. **POST /rooms без токена** → 401 `SESSION_INVALID`.
13. **POST /rooms с `joinPolicy: 'invite_only'`** → 201, `joinPolicy: 'invite_only'`; с лишним ключом → 400 `REQUEST_INVALID`.
14. **Rate-limit callback** (REQ-SEC-007): boot с `OAUTH_RATE_LIMIT: '2'` → три callback-запроса → третий 429 `RATE_LIMITED`.
15. **Ни один ответ не несёт message/stack** — пробежаться по негативным ответам: body — ровно `{code}` (assert Object.keys).

UUID-литералы — только v4-nibble (global constraint).

- [ ] **Step 2: Run**

```bash
pnpm build
pnpm --filter @mymozhem/server test -t "oauth"
```

Матчей >0; зелёный. Падения — чинить в этом таске (опыт прошлых срезов: e2e на проводе — ловец реальных багов; unit-фейки могли что-то не увидеть).

- [ ] **Step 3: Commit**

```bash
git add apps/server/test/oauth.e2e-spec.ts
git commit -m "test(server): e2e OAuth-флоу на проводе — полный путь + негативные + POST /rooms (REQ-ID-015/009, REQ-SEC-006)"
```

---

### Task 9: Гейты зелёные

- [ ] **Step 1: Полный конвейер**

```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @mymozhem/core test:int && pnpm --filter @mymozhem/server test && pnpm boundary-check && pnpm guardrails
```

(точные script-имена — по `package.json` корня; порядок build → boundary-check критичен: круизер смотрит dist, HANDOFF-опыт.)

- [ ] **Step 2: boundary-check для нового модуля**

Если `.dependency-cruiser.cjs` режет импорты `oauth/*` — диагностировать ДО вывода «граница нарушена» (HANDOFF-опыт: легальный type-import из свежего dist может зажечь правило). Легитимные правки конфига круизера — с тестом-пробой, что src-нарушения по-прежнему ловятся (прецедент правила `socketio-only-in-realtime`).

- [ ] **Step 3: Финальный прогон и commit при необходимости**

Красное чинится в этом таске. Финал: весь конвейер зелёный; `git status` чистый.

---

## Self-review (пройдено автором плана)

- **Покрытие дизайна:** §1 REQ-список → header плана; §2 компоненты → Tasks 6/7; §3 флоу → Tasks 6/7/8; §4 модель/provisioning → Tasks 3/5; §5 токены+кука+конфиг-инвариант → Tasks 2/4; §6 POST /rooms → Task 7 + e2e Task 8; §7 коды/фильтр → Tasks 1/7; §8 конфиг → Task 2; §9 тесты → контракт (T1), unit (T2/4/6), int (T3/4/5), e2e (T8); §10 швы — не реализуются (по определению); §11 риски — зафиксированы в дизайне, код-последствия (частичный RoomError-маппинг, Lax-куки) покрыты T7/T8.
- **Инвариант «трёх мест»** (partial index / RoomService.create / findOrCreateByProvider) — комментарий в Task 5; при мерже уходит в HANDOFF.
- **Type consistency:** `IssuedTokens.kind` (T4) потребляется T4-контроллерами, T6 (mock), T7 (callback); `OAUTH_PROVIDER_CLIENT` производится T6, потребляется T7/T8; имена кук — единый `oauth.constants` (T6), потребители T7/T8; `authenticate` — T7 единственная точка.
