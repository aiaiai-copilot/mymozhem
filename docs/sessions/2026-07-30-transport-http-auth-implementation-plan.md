# Транспортный auth/HTTP срез — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Первый HTTP-выход наружу: guest-join с выдачей токен-пары, refresh с ротацией, типизированные ошибки (REQ-SEC-006), контроли первого exposure.

**Architecture:** Новый `TransportModule` в `packages/core` (контроллеры + глобальный фильтр), новый `AuthModule` с `TokenService` (JWT + таблица `identity."Session"`). DTO и коды ошибок — в SDK (контракт 1.0.0 → 1.1.0, аддитивно). `apps/server` остаётся чистым composition root: один импорт модуля + регистрация fastify-плагинов в `main.ts`.

**Tech Stack:** NestJS 11 (Fastify-адаптер), Prisma 7.8 (adapter-pg, multiSchema), zod 4, jsonwebtoken (HS256), @fastify/cookie + @fastify/helmet + @fastify/cors, Jest + testcontainers.

**Дизайн:** `docs/sessions/2026-07-30-transport-http-auth-design.md` — источник решений (§0 — решения владельца). Отступления от дизайна не допускаются без флага владельцу.

## Global Constraints

- Замороженные миграции не изменяются; новая схема — только новой миграцией. Миграция авторится через эфемерный контейнер на свободном порту (НЕ 5432 — там чужой `lt-pg`, не трогать).
- Prisma 7.8 adapter-pg: `$queryRaw` не десериализует void-выражения — использовать `$executeRaw`; SQLSTATE сидит внутри `P2010`-ошибки (message / `meta.driverAdapterError.cause.originalCode`), никогда в топ-левел `err.code`.
- Jest CLI: рабочая форма `pnpm --filter @mymozhem/core test:int -t "..."` (БЕЗ `--`).
- Интеграционная лана требует запущенный Docker Desktop; один контейнер на `startTestDb`, `maxWorkers: 1`.
- `pnpm exec prisma generate` требует `DATABASE_URL` в env и cwd = корень репозитория.
- Один lockfile; новые зависимости только через `pnpm --filter <pkg> add`.
- Контроллеры HTTP-статусов не знают; весь маппинг — в фильтре (дизайн §5).
- Refresh-токен никогда не в теле ответа и не в URL — только httpOnly-cookie (REQ-ID-008).
- Наружу — только `{code}`, без message/stack при ЛЮБОЙ ошибке (REQ-SEC-006).

---

### Task 1: SDK — DTO join/token, новые коды ошибок, контракт 1.1.0

**REQ:** REQ-SEC-006 (wire-формат), REQ-ID-003 (join DTO), REQ-ID-016 (token DTO), REQ-CTR-004 (версия = версия пакета).

**Files:**
- Create: `packages/sdk/src/auth/join-request.ts`
- Create: `packages/sdk/src/auth/join-request.fixtures.ts`
- Create: `packages/sdk/src/auth/join-request.contract.spec.ts`
- Create: `packages/sdk/src/auth/token-response.ts`
- Create: `packages/sdk/src/auth/token-response.contract.spec.ts`
- Modify: `packages/sdk/src/errors/error-codes.ts` (добавить 6 кодов)
- Modify: `packages/sdk/src/errors/error-codes.contract.spec.ts` (если есть; иначе коды покрываются join/token спеками — проверить существование, не создавать дубль)
- Modify: `packages/sdk/src/index.ts` (экспорты)
- Modify: `packages/sdk/src/contract-version.ts` (`CONTRACT_VERSION = '1.1.0'`)
- Modify: `packages/sdk/package.json` (`"version": "1.1.0"`)

**Interfaces:**
- Produces: `joinRequestSchema: z.ZodType<{ code: string; displayName: string }>`, `JoinRequest`; `tokenResponseSchema`, `TokenResponse = { accessToken: string; tokenType: 'Bearer'; expiresIn: number }`. Новые коды в `CONTRACT_ERROR_CODES`: `'ROOM_JOIN_DENIED'`, `'ROOM_PARTICIPANT_LIMIT_REACHED'`, `'RATE_LIMITED'`, `'REQUEST_INVALID'`, `'SESSION_INVALID'`, `'INTERNAL_ERROR'`.

- [ ] **Step 1: Падающий contract-тест join-request**

`packages/sdk/src/auth/join-request.fixtures.ts`:
```ts
export const validJoinRequests: unknown[] = [
  { code: 'ABCDEFGH', displayName: 'Alex' },
  { code: 'x', displayName: '  Аня  ' },
];
export const invalidJoinRequests: unknown[] = [
  {},
  { code: 'ABCDEFGH' },
  { displayName: 'Alex' },
  { code: '', displayName: 'Alex' },
  { code: 'ABCDEFGH', displayName: '' },
  { code: 'ABCDEFGH', displayName: 'x'.repeat(41) },
  { code: 'ABCDEFGH', displayName: 'Alex', extra: true }, // strictObject
  'not-an-object',
];
```

`packages/sdk/src/auth/join-request.contract.spec.ts`:
```ts
import { joinRequestSchema } from './join-request';
import { validJoinRequests, invalidJoinRequests } from './join-request.fixtures';

describe('joinRequest contract (REQ-ID-003)', () => {
  it.each(validJoinRequests.map((v) => [JSON.stringify(v), v] as const))('accepts %s', (_l, v) => {
    expect(joinRequestSchema.safeParse(v).success).toBe(true);
  });
  it.each(invalidJoinRequests.map((v) => [JSON.stringify(v), v] as const))('rejects %s', (_l, v) => {
    expect(joinRequestSchema.safeParse(v).success).toBe(false);
  });
  it('trims displayName via the shared displayNameSchema', () => {
    expect(joinRequestSchema.parse({ code: 'ABCDEFGH', displayName: '  Alex  ' }).displayName).toBe('Alex');
  });
});
```

- [ ] **Step 2: Прогнать — падает** (`pnpm --filter @mymozhem/sdk test -t joinRequest` → модуль не найден)

- [ ] **Step 3: Реализация join-request + token-response**

`packages/sdk/src/auth/join-request.ts`:
```ts
import { z } from 'zod';
import { displayNameSchema } from '../identity/display-name';

// POST /rooms/join request body (REQ-ID-003). strict: лишние ключи не проходят границу.
export const joinRequestSchema = z.strictObject({
  code: z.string().trim().min(1),
  displayName: displayNameSchema,
});
export type JoinRequest = z.infer<typeof joinRequestSchema>;
```

`packages/sdk/src/auth/token-response.ts`:
```ts
import { z } from 'zod';

// Ответ join/refresh (REQ-ID-016). Refresh никогда не ездит в теле — он httpOnly-cookie
// (REQ-ID-008), поэтому его здесь нет и быть не может.
export const tokenResponseSchema = z.strictObject({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;
```

`packages/sdk/src/auth/token-response.contract.spec.ts`:
```ts
import { tokenResponseSchema } from './token-response';

describe('tokenResponse contract (REQ-ID-016)', () => {
  it('accepts a well-formed response', () => {
    expect(tokenResponseSchema.safeParse({ accessToken: 'a.b.c', tokenType: 'Bearer', expiresIn: 900 }).success).toBe(true);
  });
  it.each([
    { accessToken: '', tokenType: 'Bearer', expiresIn: 900 },
    { accessToken: 'a.b.c', tokenType: 'bearer', expiresIn: 900 },
    { accessToken: 'a.b.c', tokenType: 'Bearer', expiresIn: 0 },
    { accessToken: 'a.b.c', tokenType: 'Bearer', expiresIn: 900, refreshToken: 'x' }, // strict
  ])('rejects %j', (v) => {
    expect(tokenResponseSchema.safeParse(v).success).toBe(false);
  });
});
```

- [ ] **Step 4: Коды ошибок + версия**

В `packages/sdk/src/errors/error-codes.ts` добавить в `CONTRACT_ERROR_CODES` (комментарием отделить от существующих):
```ts
  // Transport-facing API errors (first HTTP slice, REQ-SEC-006).
  'ROOM_JOIN_DENIED',
  'ROOM_PARTICIPANT_LIMIT_REACHED',
  'RATE_LIMITED',
  'REQUEST_INVALID',
  'SESSION_INVALID',
  'INTERNAL_ERROR',
```
В `contract-version.ts`: `CONTRACT_VERSION = '1.1.0'` (аддитивное расширение → minor). В `packages/sdk/package.json`: `"version": "1.1.0"`.

В `packages/sdk/src/index.ts` добавить:
```ts
export * from './auth/join-request';
export * from './auth/join-request.fixtures';
export * from './auth/token-response';
```

- [ ] **Step 5: Прогнать все тесты sdk — зелёные, включая parity-тест версии**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: PASS (parity-тест `contract-version.contract.spec.ts` проходит, т.к. версия поднята в обоих местах).

- [ ] **Step 6: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): join/token DTO + transport error codes, contract 1.1.0 (REQ-ID-003, REQ-ID-016, REQ-SEC-006)"
```

---

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

### Task 3: Миграция — `identity."Session"`

**REQ:** REQ-ID-007 (хэшированный refresh, семейства ротации), REQ-ID-016 (expiry).

**Files:**
- Modify: `packages/core/prisma/schema.prisma`
- Create: `packages/core/prisma/migrations/<timestamp>_auth_sessions/migration.sql` (генерируется)
- Create: `packages/core/src/auth/session-schema.int-spec.ts`

**Interfaces:**
- Produces: Prisma-модель `Session` (`prisma.session`): поля `id, identityId, refreshTokenHash (unique), familyId, replacedById?, revokedAt?, expiresAt, createdAt`.

- [ ] **Step 1: Схема**

В `schema.prisma` добавить модель и связь в `Identity` (`sessions Session[]`):
```prisma
model Session {
  id               String    @id @default(uuid()) @db.Uuid
  identity         Identity  @relation(fields: [identityId], references: [id])
  identityId       String    @db.Uuid
  refreshTokenHash String    @unique
  familyId         String    @db.Uuid
  replacedById     String?   @db.Uuid
  revokedAt        DateTime?
  expiresAt        DateTime
  createdAt        DateTime  @default(now())

  @@schema("identity")
}
```

- [ ] **Step 2: Авторинг миграции через эфемерный контейнер (порт 55434, НЕ 5432)**

```bash
docker run -d --name mm-migrate -e POSTGRES_PASSWORD=postgres -p 55434:5432 postgres:17
# дождаться готовности: docker exec mm-migrate pg_isready -U postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:55434/postgres pnpm exec prisma migrate dev --name auth_sessions
DATABASE_URL=postgresql://postgres:postgres@localhost:55434/postgres pnpm exec prisma generate
docker rm -f mm-migrate
```
Проверить SQL: таблица в схеме `identity`, UNIQUE на `refreshTokenHash`, FK на `identity."Identity"`. Если `prisma generate` молча не регенерировал клиент — повторить явно (известная ловушка, HANDOFF).

- [ ] **Step 3: Presence-тест миграции (конвенция репо, см. membership-schema.int-spec.ts)**

`packages/core/src/auth/session-schema.int-spec.ts`:
```ts
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';

describe('identity."Session" schema (REQ-ID-007)', () => {
  let db: TestDb;
  beforeAll(async () => { db = await startTestDb(); }, 120000);
  afterAll(async () => { await db.stop(); });

  it('table exists in the identity schema', async () => {
    const rows = await db.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM information_schema.tables
      WHERE table_schema = 'identity' AND table_name = 'Session'`;
    expect(Number(rows[0].count)).toBe(1);
  });

  it('refreshTokenHash is unique', async () => {
    const rows = await db.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pg_indexes
      WHERE schemaname = 'identity' AND tablename = 'Session'
        AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%refreshTokenHash%'`;
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 4: Прогнать** `pnpm --filter @mymozhem/core test:int -t "Session schema"` — зелёно

- [ ] **Step 5: Commit**

```bash
git add packages/core/prisma packages/core/src/auth/session-schema.int-spec.ts
git commit -m "feat(core): identity.Session table for refresh token families (REQ-ID-007)"
```

---

### Task 4: TokenService — issue/verify (unit-часть)

**REQ:** REQ-ID-007 (opaque refresh, SHA-256 хэш), REQ-ID-008, REQ-ID-016 (guest claims с roomId, refresh ≤ guest_ttl), REQ-SEC-002 (HS256 по JWT_SECRET).

**Files:**
- Create: `packages/core/src/auth/auth.errors.ts`
- Create: `packages/core/src/auth/auth.constants.ts`
- Create: `packages/core/src/auth/token.service.ts`
- Create: `packages/core/src/auth/token.service.spec.ts`
- Create: `packages/core/src/auth/auth.module.ts`
- Modify: `packages/core/src/index.ts` (экспорты auth + позже transport)
- Modify: `packages/core/package.json` (+ `jsonwebtoken`), devDeps (+ `@types/jsonwebtoken`)

**Interfaces:**
- Consumes: `PrismaService` (`prisma.session` из Task 3), `AppConfig` (Task 2).
- Produces:
  - `AUTH_ERROR_CODES.SESSION_INVALID = 'SESSION_INVALID'`, `class AuthError extends Error { readonly code }`.
  - `REFRESH_COOKIE = 'mm_refresh'`.
  - `interface AccessClaims { sub: string; sid: string; kind: 'GUEST' | 'REGISTERED'; roomId?: string }`.
  - `interface IssuedTokens { accessToken: string; expiresIn: number; refreshToken: string }`.
  - `TokenService`: `issueGuestTokens(identityId: string, roomId: string): Promise<IssuedTokens>`, `verifyAccessToken(token: string): AccessClaims`, `rotate(refreshToken: string): Promise<IssuedTokens>` (rotate — Task 5).

- [ ] **Step 1: Зависимости**

```bash
pnpm --filter @mymozhem/core add jsonwebtoken
pnpm --filter @mymozhem/core add -D @types/jsonwebtoken
```

- [ ] **Step 2: Падающие unit-тесты (token.service.spec.ts)**

Тесты конструируют сервис вручную с моком prisma (`{ session: { create: jest.fn() } }` кастом в `any` на уровне вызова `new TokenService(mock as never, TEST_CONFIG)`):
```ts
import { TokenService } from './token.service';
import { AuthError } from './auth.errors';
import { TEST_CONFIG } from '../testing/test-config';

const makeService = () => {
  const sessionCreate = jest.fn().mockImplementation(({ data }) =>
    Promise.resolve({ id: 'sess-1', ...data }),
  );
  const prisma = { session: { create: sessionCreate } };
  const service = new TokenService(prisma as never, TEST_CONFIG);
  return { service, sessionCreate };
};

describe('TokenService.issueGuestTokens (REQ-ID-007/016)', () => {
  it('signs HS256 access with guest claims and stores only the refresh hash', async () => {
    const { service, sessionCreate } = makeService();
    const issued = await service.issueGuestTokens('ident-1', 'room-1');

    const claims = service.verifyAccessToken(issued.accessToken);
    expect(claims).toMatchObject({ sub: 'ident-1', sid: 'sess-1', kind: 'GUEST', roomId: 'room-1' });
    expect(issued.expiresIn).toBe(TEST_CONFIG.ACCESS_TOKEN_TTL);

    const stored = sessionCreate.mock.calls[0][0].data;
    expect(stored.identityId).toBe('ident-1');
    expect(stored.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex, не сам токен
    expect(stored.refreshTokenHash).not.toBe(issued.refreshToken);
    expect(stored.familyId).toEqual(expect.any(String));
  });

  it('caps session expiry by min(REFRESH_TOKEN_TTL, GUEST_TTL) (REQ-ID-016)', async () => {
    const { service, sessionCreate } = makeService();
    await service.issueGuestTokens('ident-1', 'room-1');
    const expiresAt: Date = sessionCreate.mock.calls[0][0].data.expiresAt;
    const expectedMs = Math.min(TEST_CONFIG.REFRESH_TOKEN_TTL, TEST_CONFIG.GUEST_TTL) * 1000;
    expect(Math.abs(expiresAt.getTime() - (Date.now() + expectedMs))).toBeLessThan(5000);
  });

  it('issues distinct refresh tokens per call', async () => {
    const { service } = makeService();
    const a = await service.issueGuestTokens('i', 'r');
    const b = await service.issueGuestTokens('i', 'r');
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });
});

describe('TokenService.verifyAccessToken', () => {
  it('rejects a token signed with another secret', async () => {
    const { service } = makeService();
    const { default: jwt } = await import('jsonwebtoken');
    const foreign = jwt.sign({ sub: 'x', sid: 'y', kind: 'GUEST', roomId: 'r' }, 'wrong-secret-wrong-secret-32bytes!', { algorithm: 'HS256' });
    expect(() => service.verifyAccessToken(foreign)).toThrow(AuthError);
  });

  it('rejects a malformed token', () => {
    const { service } = makeService();
    expect(() => service.verifyAccessToken('not-a-jwt')).toThrow(AuthError);
  });
});
```

- [ ] **Step 3: Прогнать — падает** (`pnpm --filter @mymozhem/core test -t TokenService`)

- [ ] **Step 4: Реализация**

`auth.constants.ts`:
```ts
// Имя refresh-куки. Path=/auth выставляется контроллером — кука не уходит никуда,
// кроме refresh-эндпоинта (REQ-ID-008).
export const REFRESH_COOKIE = 'mm_refresh';
```

`auth.errors.ts` (по образцу membership.errors.ts):
```ts
// Core-internal auth errors. Наружу фильтр отдаёт один код SESSION_INVALID для всех
// отказов refresh — reuse/expired/unknown неразличимы снаружи (design §5, принцип REQ-ID-013).
export const AUTH_ERROR_CODES = { SESSION_INVALID: 'SESSION_INVALID' } as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
  }
}
```

`token.service.ts`:
```ts
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { AUTH_ERROR_CODES, AuthError } from './auth.errors';

export interface AccessClaims {
  sub: string; // identityId
  sid: string; // session id
  kind: 'GUEST' | 'REGISTERED';
  roomId?: string; // guest scope (REQ-ID-016); REGISTERED — без roomId
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // Единственная выдача в этом срезе — гостевая (REQ-ID-016): roomId зашит в claims.
  async issueGuestTokens(identityId: string, roomId: string): Promise<IssuedTokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    const session = await this.prisma.session.create({
      data: {
        identityId,
        refreshTokenHash: sha256(refreshToken),
        familyId: randomUUID(),
        expiresAt: this.sessionExpiry(),
      },
    });
    return {
      accessToken: this.signAccess({ sub: identityId, sid: session.id, kind: 'GUEST', roomId }),
      expiresIn: this.config.ACCESS_TOKEN_TTL,
      refreshToken,
    };
  }

  // Access — stateless; verify используется будущим realtime-handshake (REQ-RT-009).
  verifyAccessToken(token: string): AccessClaims {
    let decoded: jwt.JwtPayload;
    try {
      const raw = jwt.verify(token, this.config.JWT_SECRET, { algorithms: ['HS256'] });
      if (typeof raw === 'string') throw new Error('string payload');
      decoded = raw;
    } catch (err) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, `access verify failed: ${(err as Error).message}`);
    }
    if (
      typeof decoded.sub !== 'string' ||
      typeof decoded.sid !== 'string' ||
      (decoded.kind !== 'GUEST' && decoded.kind !== 'REGISTERED')
    ) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'access claims malformed');
    }
    return { sub: decoded.sub, sid: decoded.sid, kind: decoded.kind, roomId: typeof decoded.roomId === 'string' ? decoded.roomId : undefined };
  }

  protected sessionExpiry(): Date {
    return new Date(Date.now() + Math.min(this.config.REFRESH_TOKEN_TTL, this.config.GUEST_TTL) * 1000);
  }

  protected signAccess(claims: AccessClaims): string {
    return jwt.sign(claims, this.config.JWT_SECRET, { algorithm: 'HS256', expiresIn: this.config.ACCESS_TOKEN_TTL });
  }
}
```

`auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '../config/config.module';
import { TokenService } from './token.service';

@Module({ imports: [PrismaModule, ConfigModule], providers: [TokenService], exports: [TokenService] })
export class AuthModule {}
```

В `packages/core/src/index.ts` добавить:
```ts
export * from './auth/auth.constants';
export * from './auth/auth.errors';
export * from './auth/token.service';
export * from './auth/auth.module';
```

- [ ] **Step 5: Прогнать unit — зелёно; `pnpm --filter @mymozhem/core typecheck` — зелёно**

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/auth packages/core/src/index.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): TokenService issue/verify with hashed refresh families (REQ-ID-007, REQ-ID-016)"
```

---

### Task 5: TokenService.rotate — ротация, reuse-detection, REQ-ID-016 проверки (integration)

**REQ:** REQ-ID-007 (ротация при каждом refresh; reuse → revoke семейства), REQ-ID-016 (инвалидация при терминальной комнате / TTL гостя / удалённой identity).

**Files:**
- Modify: `packages/core/src/auth/token.service.ts` (добавить `rotate`)
- Create: `packages/core/src/auth/token.service.int-spec.ts`

**Interfaces:**
- Consumes: `RoomService.create`, `MembershipService.join` (для посева гостя+членства), `seedIdentity`, `startTestDb`, `TEST_CONFIG`.
- Produces: `TokenService.rotate(refreshToken: string): Promise<IssuedTokens>`.

**Design-решения в коде (дизайн §4):**
- Гостевая сессия ↔ единственное членство гостя: `roomId` для новых claims берётся из членства identity (у гостя ровно одно). REGISTERED-ветка (не используется в срезе) пропускает room-проверки.
- Гонка двух параллельных refresh: conditional `updateMany` (`replacedById: null AND revokedAt: null AND expiresAt > now`) — побеждает один; проигравший получает `SESSION_INVALID`, семейство НЕ ревокается (это не кража, а гонка).
- Повторное предъявление УЖЕ ротированного токена (`replacedById != null`) → `updateMany` revoke всего `familyId` → `SESSION_INVALID` (REQ-ID-007).
- `expiresAt` новой сессии — sliding (`now + min(REFRESH,GUEST_TTL)`); гостевой потолок всё равно сдержан TTL-проверкой identity.

- [ ] **Step 1: Падающий int-spec (token.service.int-spec.ts)**

Каркас по образцу `membership.service.int-spec.ts` (ручное конструирование, `startTestDb`, TRUNCATE в afterEach — добавить `identity."Session"` в список). Посев: `seedIdentity` (организатор) → `RoomService.create` → `MembershipService.join` → `TokenService.issueGuestTokens`. Тесты:
```ts
it('rotates: old refresh dies, new pair works, familyId preserved', async () => {
  const first = await tokens.issueGuestTokens(identity.id, room.id);
  const second = await tokens.rotate(first.refreshToken);
  expect(second.refreshToken).not.toBe(first.refreshToken);
  const claims = tokens.verifyAccessToken(second.accessToken);
  expect(claims).toMatchObject({ sub: identity.id, kind: 'GUEST', roomId: room.id });
  const sessions = await db.prisma.session.findMany({ where: { familyId: (await db.prisma.session.findFirstOrThrow())!.familyId } });
  expect(sessions).toHaveLength(2);
  await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(AuthError); // старый мёртв
});

it('reuse of an already-rotated token revokes the whole family (REQ-ID-007)', async () => {
  const first = await tokens.issueGuestTokens(identity.id, room.id);
  const second = await tokens.rotate(first.refreshToken);
  await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(AuthError); // reuse → revoke
  await expect(tokens.rotate(second.refreshToken)).rejects.toThrow(AuthError); // новый тоже мёртв
  const alive = await db.prisma.session.count({ where: { revokedAt: null } });
  expect(alive).toBe(0);
});

it('rejects an unknown refresh token', async () => {
  await expect(tokens.rotate('nope')).rejects.toThrow(AuthError);
});

it('rejects refresh when the room is COMPLETED (REQ-ID-016)', async () => {
  const first = await tokens.issueGuestTokens(identity.id, room.id);
  await roomService.complete(room.id); // DRAFT→ACTIVE→COMPLETED по стейт-машине: сначала activate
  await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(AuthError);
});

it('rejects refresh when guest TTL expired (REQ-ID-016)', async () => {
  const first = await tokens.issueGuestTokens(identity.id, room.id);
  await db.prisma.identity.update({ where: { id: identity.id }, data: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) } });
  await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(AuthError);
});

it('rejects refresh when identity is soft-deleted', async () => { /* deletedAt: new Date() → AuthError */ });

it('rejects refresh when session is expired', async () => {
  // expiresAt в прошлое напрямую в БД → AuthError
});

it('only one of two concurrent rotations wins; family NOT revoked on race', async () => {
  const first = await tokens.issueGuestTokens(identity.id, room.id);
  const results = await Promise.allSettled([tokens.rotate(first.refreshToken), tokens.rotate(first.refreshToken)]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  expect(ok).toHaveLength(1);
  const alive = await db.prisma.session.count({ where: { revokedAt: null } });
  expect(alive).toBe(1); // семейство живо, победитель может продолжать
});
```
*Комната для `complete` должна быть ACTIVE: `await roomService.activate(room.id)` затем `complete`. Проверить сигнатуры переходов в room.service.ts — если `activate/complete` требуют configure (ROOM_NOT_CONFIGURED), посев упрощается: терминальность достигается через `cancel` (DRAFT→CANCELLED) — выбрать по факту сигнатур.*

- [ ] **Step 2: Прогнать — падает** (`pnpm --filter @mymozhem/core test:int -t "TokenService.rotate"`, ожидаемо: `rotate is not a function`)

- [ ] **Step 3: Реализация rotate в token.service.ts**

```ts
  // Ротация (REQ-ID-007) + проверки жизни гостевой сессии (REQ-ID-016). Все отказные
  // ветки — один SESSION_INVALID наружу; различие только в server-side message.
  async rotate(refreshToken: string): Promise<IssuedTokens> {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
    });
    if (!session) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'unknown refresh token');
    }
    if (session.replacedById !== null) {
      // Предъявлен уже ротированный токен — сигнал кражи: гасим всё семейство (REQ-ID-007).
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, `refresh reuse detected, family ${session.familyId} revoked`);
    }
    if (session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'session revoked or expired');
    }

    const identity = await this.prisma.identity.findUnique({ where: { id: session.identityId } });
    if (!identity || identity.deletedAt !== null) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'identity gone');
    }

    let roomId: string | undefined;
    if (identity.kind === 'GUEST') {
      if (identity.createdAt.getTime() + this.config.GUEST_TTL * 1000 <= Date.now()) {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'guest TTL expired');
      }
      // Гость живёт ровно в одной комнате — членство и есть scope сессии (design §4).
      const membership = await this.prisma.membership.findFirst({ where: { identityId: identity.id } });
      if (!membership) {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'membership gone');
      }
      const room = await this.prisma.room.findUnique({ where: { id: membership.roomId } });
      if (!room || room.status === 'COMPLETED' || room.status === 'CANCELLED' || room.deletedAt !== null) {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'room terminal');
      }
      roomId = membership.roomId;
    }

    const newRefreshToken = randomBytes(32).toString('base64url');
    const newSessionId = randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        // Атомарный захват ротации: проигравший гонку видит count=0 → SESSION_INVALID,
        // семейство НЕ ревокается (гонка ≠ кража, design §4).
        const claimed = await tx.session.updateMany({
          where: { id: session.id, replacedById: null, revokedAt: null, expiresAt: { gt: new Date() } },
          data: { replacedById: newSessionId },
        });
        if (claimed.count === 0) {
          throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'rotation race lost');
        }
        await tx.session.create({
          data: {
            id: newSessionId,
            identityId: session.identityId,
            refreshTokenHash: sha256(newRefreshToken),
            familyId: session.familyId,
            expiresAt: this.sessionExpiry(),
          },
        });
      });
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, `rotation failed: ${(err as Error).message}`);
    }

    return {
      accessToken: this.signAccess({ sub: identity.id, sid: newSessionId, kind: identity.kind, roomId }),
      expiresIn: this.config.ACCESS_TOKEN_TTL,
      refreshToken: newRefreshToken,
    };
  }
```

- [ ] **Step 4: Прогнать int — зелёно; вся int-лана core — зелёно** (`pnpm --filter @mymozhem/core test:int`)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth
git commit -m "feat(core): refresh rotation with reuse detection and REQ-ID-016 invalidation"
```

---

### Task 6: JoinRateLimiter — eviction протухших записей (parked minor)

**REQ:** REQ-ID-006 (лимитер — носитель); parked minor из handoff: Map растёт по одной записи на one-shot IP за жизнь процесса.

**Files:**
- Modify: `packages/core/src/membership/join-rate-limiter.ts`
- Modify: `packages/core/src/membership/join-rate-limiter.spec.ts`

- [ ] **Step 1: Падающий тест**

```ts
it('sweeps expired entries so the map does not grow per one-shot IP', () => {
  let now = 1_000_000;
  const limiter = new JoinRateLimiter(10, 60_000, () => now);
  for (let i = 0; i < 100; i++) limiter.tryAcquire(`10.0.0.${i}`);
  expect((limiter as unknown as { attempts: Map<string, unknown> }).attempts.size).toBe(100);
  now += 61_000; // все окна протухли
  limiter.tryAcquire('10.1.0.1'); // триггер sweep
  expect((limiter as unknown as { attempts: Map<string, unknown> }).attempts.size).toBe(1);
});

it('does not sweep within the same window (amortized)', () => {
  let now = 1_000_000;
  const limiter = new JoinRateLimiter(10, 60_000, () => now);
  limiter.tryAcquire('10.0.0.1');
  now += 30_000; // внутри окна
  limiter.tryAcquire('10.0.0.2');
  expect((limiter as unknown as { attempts: Map<string, unknown> }).attempts.size).toBe(2);
});
```

- [ ] **Step 2: Прогнать — падает** (`pnpm --filter @mymozhem/core test -t JoinRateLimiter`)

- [ ] **Step 3: Реализация**

```ts
export class JoinRateLimiter {
  private readonly attempts = new Map<string, { windowStart: number; count: number }>();
  private lastSweep: number;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.lastSweep = this.now();
  }

  tryAcquire(ip: string): boolean {
    const now = this.now();
    // Ленивый sweep не чаще раза в окно: one-shot IP не копятся на жизнь процесса
    // (parked minor membership-среза; амортизировано O(n) раз в windowMs).
    if (now - this.lastSweep >= this.windowMs) {
      for (const [key, entry] of this.attempts) {
        if (now - entry.windowStart >= this.windowMs) this.attempts.delete(key);
      }
      this.lastSweep = now;
    }
    const entry = this.attempts.get(ip);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.attempts.set(ip, { windowStart: now, count: 1 });
      return true;
    }
    if (entry.count >= this.limit) {
      return false;
    }
    entry.count += 1;
    return true;
  }
}
```
Также обновить header-комментарий файла: убрать «Map growth: one entry per distinct IP per process lifetime», заменить на описание lazy sweep.

- [ ] **Step 4: Прогнать — зелёно (все тесты лимитера, включая старые)**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/membership/join-rate-limiter.ts packages/core/src/membership/join-rate-limiter.spec.ts
git commit -m "fix(core): sweep expired JoinRateLimiter entries (REQ-ID-006)"
```

---

### Task 7: HttpExceptionFilter — типизированные ошибки наружу (REQ-SEC-006)

**REQ:** REQ-SEC-006 (только `{code}`, без message/stack), REQ-ID-013 (неразличимость — обеспечена сколлапсированными кодами core), parked minor (uuid-сырьё → типизированная ошибка).

**Files:**
- Create: `packages/core/src/transport/http-exception.filter.ts`
- Create: `packages/core/src/transport/http-exception.filter.spec.ts`

**Interfaces:**
- Consumes: `MembershipError` (+ коды), `AuthError`, `ContractError` (SDK), `ZodError`, `Prisma.PrismaClientKnownRequestError`.
- Produces: `HttpExceptionFilter implements ExceptionFilter` (регистрация — Task 8 через `APP_FILTER`). Маппинг (дизайн §5):

| Вход | status | code |
|---|---|---|
| `MembershipError` code `ROOM_JOIN_DENIED` | 403 | `ROOM_JOIN_DENIED` |
| `MembershipError` code `JOIN_RATE_LIMITED` | 429 | `RATE_LIMITED` (wire-код отличается от core-кода — дизайн §5) |
| `MembershipError` code `ROOM_PARTICIPANT_LIMIT_REACHED` | 409 | `ROOM_PARTICIPANT_LIMIT_REACHED` |
| `AuthError` (любой) | 401 | `SESSION_INVALID` |
| `ZodError` | 400 | `REQUEST_INVALID` |
| `Prisma.PrismaClientKnownRequestError` (любой P-код, включая P2010/22P02 uuid-сырьё) | 400 | `REQUEST_INVALID` |
| `HttpException` (Nest built-ins: 404 неизвестного роута и т.п.) | его status | `REQUEST_INVALID` (4xx) / `INTERNAL_ERROR` (5xx) |
| всё прочее | 500 | `INTERNAL_ERROR` |

- [ ] **Step 1: Падающий unit-тест**

Фильтр тестируется без Nest: мок `ArgumentsHost` (`switchToHttp().getResponse()` → `{ status: jest.fn().mockReturnThis(), send: jest.fn() }`). Кейсы — вся таблица выше + инвариант REQ-SEC-006:
```ts
it.each([
  ['join denied', new RoomJoinDeniedError('no room for code'), 403, 'ROOM_JOIN_DENIED'],
  ['rate limited', new JoinRateLimitedError('x'), 429, 'RATE_LIMITED'],
  ['room full', new RoomParticipantLimitReachedError('x'), 409, 'ROOM_PARTICIPANT_LIMIT_REACHED'],
  ['auth', new AuthError('SESSION_INVALID', 'reuse detected, family revoked'), 401, 'SESSION_INVALID'],
  ['zod', new ZodError([]), 400, 'REQUEST_INVALID'],
  ['unknown', new Error('boom with sensitive internals'), 500, 'INTERNAL_ERROR'],
])('%s → typed wire error without internals', (_l, err, status, code) => {
  const { filter, reply } = makeFilter();
  filter.catch(err, makeHost(reply) as never);
  expect(reply.status).toHaveBeenCalledWith(status);
  const body = reply.send.mock.calls[0][0];
  expect(body).toEqual({ code }); // ровно {code} — ни message, ни stack (REQ-SEC-006)
  expect(JSON.stringify(body)).not.toContain('sensitive internals');
});
```
Плюс кейс Prisma-сырья: сконструировать `new Prisma.PrismaClientKnownRequestError('Raw query failed. Code: `22P02`. Message: invalid uuid', { code: 'P2010', clientVersion: '7.8.0' } as never)` → 400 `REQUEST_INVALID`. (Точную сигнатуру конструктора сверить по `@prisma/client` v7; если конструктор закрыт — сымитировать через `Object.create(Prisma.PrismaClientKnownRequestError.prototype)` с присвоенными `code`/`message`.)

- [ ] **Step 2: Прогнать — падает**

- [ ] **Step 3: Реализация (http-exception.filter.ts)**

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { MembershipError } from '../membership/membership.errors';
import { AuthError } from '../auth/auth.errors';

// Единственная точка маппинга ошибка → HTTP (design §5): контроллеры статусов не знают.
// Наружу — ровно {code} (REQ-SEC-006); полное исключение уходит только в серверный лог.
const STATUS_BY_WIRE_CODE = {
  ROOM_JOIN_DENIED: 403,
  RATE_LIMITED: 429,
  ROOM_PARTICIPANT_LIMIT_REACHED: 409,
  REQUEST_INVALID: 400,
  SESSION_INVALID: 401,
  INTERNAL_ERROR: 500,
} as const;

type WireCode = keyof typeof STATUS_BY_WIRE_CODE;

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const code = this.toWireCode(exception);
    const status: number = STATUS_BY_WIRE_CODE[code];
    if (status >= 500) this.logger.error(exception);
    void reply.status(status).send({ code });
  }

  private toWireCode(exception: unknown): WireCode {
    if (exception instanceof MembershipError) {
      // JOIN_RATE_LIMITED (core) → RATE_LIMITED (wire) — решение владельца, design §0.6.
      return exception.code === 'JOIN_RATE_LIMITED' ? 'RATE_LIMITED' : exception.code;
    }
    if (exception instanceof AuthError) return 'SESSION_INVALID';
    if (exception instanceof ZodError) return 'REQUEST_INVALID';
    // Prisma-сырьё (включая P2010+SQLSTATE 22P02 uuid-syntax — parked minor): типизируем,
    // детали не раскрываем. Отнесение всех P-кодов к 400 — решение дизайна §5.
    if (exception instanceof Prisma.PrismaClientKnownRequestError) return 'REQUEST_INVALID';
    if (exception instanceof HttpException) {
      return exception.getStatus() >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_INVALID';
    }
    return 'INTERNAL_ERROR';
  }
}
```

- [ ] **Step 4: Прогнать — зелёно; typecheck — зелёно**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/transport
git commit -m "feat(core): global HTTP exception filter with typed wire codes (REQ-SEC-006)"
```

---

### Task 8: TransportModule — контроллеры join/refresh и wiring

**REQ:** REQ-ID-003 (join), REQ-ID-008 (cookie), REQ-ID-016 (выдача пары), REQ-SEC-007 (refresh rate-limit), REQ-ID-013.

**Files:**
- Create: `packages/core/src/transport/auth.tokens.ts`
- Create: `packages/core/src/transport/refresh-cookie.ts`
- Create: `packages/core/src/transport/join.controller.ts`
- Create: `packages/core/src/transport/auth.controller.ts`
- Create: `packages/core/src/transport/transport.module.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `MembershipService.join` (→ `{ membership, identity }`), `TokenService` (`issueGuestTokens`, `rotate`), `JoinRateLimiter`, `HttpExceptionFilter`, `REFRESH_COOKIE`, SDK `joinRequestSchema`, `TokenResponse`.
- Produces: `TransportModule` (импортируется в `AppModule` в Task 9); `REFRESH_RATE_LIMITER` token.

- [ ] **Step 1: auth.tokens.ts + refresh-cookie.ts + контроллеры**

`auth.tokens.ts`:
```ts
// Отдельный инстанс лимитера для refresh-эндпоинта (REQ-SEC-007) — не делит состояние
// с join-лимитером.
export const REFRESH_RATE_LIMITER = Symbol('REFRESH_RATE_LIMITER');
```

`refresh-cookie.ts` (общий хелпер обоих контроллеров):
```ts
import type { FastifyReply } from 'fastify';
import type { AppConfig } from '../config/config.schema';
import { REFRESH_COOKIE } from '../auth/auth.constants';

// httpOnly + SameSite=Strict + Path=/auth: кука не уходит никуда, кроме
// refresh-эндпоинта (REQ-ID-008). Secure — только в production (dev/e2e по http).
export function setRefreshCookie(reply: FastifyReply, refreshToken: string, config: AppConfig): void {
  void reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/auth',
    maxAge: Math.min(config.REFRESH_TOKEN_TTL, config.GUEST_TTL),
  });
}
```

`join.controller.ts`:
```ts
import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { joinRequestSchema, type TokenResponse } from '@mymozhem/sdk';
import { MembershipService } from '../membership/membership.service';
import { TokenService } from '../auth/token.service';
import { setRefreshCookie } from './refresh-cookie';
import { APP_CONFIG } from '../config/config.tokens';
import { Inject } from '@nestjs/common';
import type { AppConfig } from '../config/config.schema';

@Controller()
export class JoinController {
  constructor(
    private readonly membership: MembershipService,
    private readonly tokens: TokenService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // actorId НЕ принимается из payload — актор определяется только выданным токеном
  // (REQ-RT-009 по духу для HTTP). ZodError/доменные ошибки уходят в фильтр.
  @Post('rooms/join')
  async join(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenResponse> {
    const { code, displayName } = joinRequestSchema.parse(body);
    const { identity, membership } = await this.membership.join({ code, displayName, ip: req.ip });
    const issued = await this.tokens.issueGuestTokens(identity.id, membership.roomId);
    setRefreshCookie(reply, issued.refreshToken, this.config);
    return { accessToken: issued.accessToken, tokenType: 'Bearer', expiresIn: issued.expiresIn };
  }
}
```

`auth.controller.ts`:
```ts
import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TokenResponse } from '@mymozhem/sdk';
import { TokenService } from '../auth/token.service';
import { AUTH_ERROR_CODES, AuthError } from '../auth/auth.errors';
import { REFRESH_COOKIE } from '../auth/auth.constants';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { JoinRateLimitedError } from '../membership/membership.errors';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { REFRESH_RATE_LIMITER } from './auth.tokens';
import { setRefreshCookie } from './refresh-cookie';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly tokens: TokenService,
    @Inject(REFRESH_RATE_LIMITER) private readonly refreshRateLimiter: JoinRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenResponse> {
    if (!this.refreshRateLimiter.tryAcquire(req.ip)) {
      throw new JoinRateLimitedError('refresh rate limit exceeded'); // wire: 429 RATE_LIMITED
    }
    const refreshToken = req.cookies[REFRESH_COOKIE];
    if (!refreshToken) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'no refresh cookie');
    }
    const issued = await this.tokens.rotate(refreshToken);
    setRefreshCookie(reply, issued.refreshToken, this.config);
    return { accessToken: issued.accessToken, tokenType: 'Bearer', expiresIn: issued.expiresIn };
  }
}
```

`transport.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { MembershipModule } from '../membership/membership.module';
import { AuthModule } from '../auth/auth.module';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { JoinController } from './join.controller';
import { AuthController } from './auth.controller';
import { HttpExceptionFilter } from './http-exception.filter';
import { REFRESH_RATE_LIMITER } from './auth.tokens';

@Module({
  imports: [ConfigModule, MembershipModule, AuthModule],
  controllers: [JoinController, AuthController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    {
      provide: REFRESH_RATE_LIMITER,
      useFactory: (config: AppConfig) => new JoinRateLimiter(config.REFRESH_RATE_LIMIT),
      inject: [APP_CONFIG],
    },
  ],
})
export class TransportModule {}
```

Экспорты в `index.ts`:
```ts
export * from './transport/transport.module';
export * from './transport/http-exception.filter';
export * from './transport/auth.tokens';
```

- [ ] **Step 2: typecheck + lint + вся unit-лана core — зелёно** (контроллеры покрываются e2e в Task 10; юнит-тестов на них нет — осознанно, логика в сервисах)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/transport packages/core/src/index.ts
git commit -m "feat(core): transport module with join/refresh controllers (REQ-ID-003, REQ-ID-008, REQ-SEC-007)"
```

---

### Task 9: apps/server — плагины, trustProxy, AppModule, health e2e env

**REQ:** REQ-SEC-008 (helmet/CORS), REQ-ID-006 (real-IP через trustProxy — parked minor), REQ-SEC-002 (env при boot), REQ-OPS-003.

**Files:**
- Modify: `apps/server/package.json` (+ `@fastify/cookie @fastify/cors @fastify/helmet`)
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/test/health.e2e-spec.ts`
- Modify: `docker-compose.yml` (JWT_SECRET для server)

- [ ] **Step 1: Зависимости**

```bash
pnpm --filter @mymozhem/server add @fastify/cookie @fastify/cors @fastify/helmet
```

- [ ] **Step 2: main.ts**

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { loadConfig } from '@mymozhem/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  // trustProxy — осознанное доверие X-Forwarded-For из конфига деплоя (REQ-ID-006,
  // parked minor): при false req.ip — непосредственный peer, XFF игнорируется.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: config.TRUST_PROXY }),
  );
  await app.register(fastifyCookie);
  await app.register(fastifyHelmet);
  // REQ-SEC-008: allowlist из конфига; пустой список = CORS-заголовки не выдаются.
  await app.register(fastifyCors, { origin: config.CORS_ORIGINS });
  await app.listen(config.PORT, '0.0.0.0');
}

void bootstrap();
```

- [ ] **Step 3: app.module.ts** — добавить `TransportModule` в imports (из `@mymozhem/core`).

- [ ] **Step 4: health.e2e-spec.ts — env + parked fix**

В `beforeAll`: `process.env.JWT_SECRET ??= 'health-e2e-secret-32-bytes-padding!';` И заменить placeholder `DATABASE_URL` на мёртвый порт (parked minor из handoff: 5432 — чужой `lt-pg`): `'postgresql://stub:stub@localhost:55999/stub'`. Плюс save/restore env (parked): сохранить исходные `DATABASE_URL`/`JWT_SECRET` в `beforeAll`, восстановить в `afterAll`.

- [ ] **Step 5: docker-compose.yml** — в `server.environment` добавить:
```yaml
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required (>=32 bytes)}
      CORS_ORIGINS: ${CORS_ORIGINS:-}
      TRUST_PROXY: ${TRUST_PROXY:-false}
```

- [ ] **Step 6: Прогнать server-тесты + typecheck всего монорепо**

Run: `pnpm build && pnpm --filter @mymozhem/server test && pnpm typecheck`
Expected: health e2e зелёный с новыми env.

- [ ] **Step 7: Commit**

```bash
git add apps/server docker-compose.yml pnpm-lock.yaml
git commit -m "feat(server): wire transport plugins and trustProxy, JWT_SECRET at boot (REQ-SEC-002, REQ-SEC-008)"
```

---

### Task 10: HTTP e2e — полный поток на testcontainer-БД

**REQ:** REQ-ID-013 (неразличимость на проводе), REQ-SEC-006 (контракт на проводе), REQ-ID-007/008/016 (поток join→refresh→reuse), REQ-SEC-007 (429 на refresh), REQ-SEC-008 (helmet/CORS заголовки).

**Files:**
- Modify: `packages/core/src/index.ts` (экспорт `testing/postgres.testcontainer`, `testing/seed-identity` — осознанное расширение barrel, design §9)
- Modify: `apps/server/package.json` (devDeps: `testcontainers`, `@testcontainers/postgresql`)
- Create: `apps/server/test/transport.e2e-spec.ts`

**Каркас:** один `startTestDb()` на файл (beforeAll, 120s), app пересобирается per describe с нужными env-override'ами (`JOIN_RATE_LIMIT_IP`, `ROOM_PARTICIPANT_LIMIT`, `REFRESH_RATE_LIMIT`); ConfigModule читает env при boot модуля. `@fastify/cookie` регистрируется в тестовом app (контроллеры зовут `setCookie`). Env в afterAll восстанавливается. TRUNCATE (`identity."Session"`, `membership."Membership"`, `room."Room"`, `identity."Identity"` CASCADE) между тестами.

Посев комнаты — через core-сервисы из dist (`RoomService`, `MembershipService`, `IdentityService`, `EventLogService`, `AppRegistryService`, `JoinRateLimiter`, `seedIdentity`, `TEST_CONFIG` — конструируются вручную, как в int-спеках).

- [ ] **Step 1: Экспорты + зависимости**

```bash
pnpm --filter @mymozhem/server add -D testcontainers @testcontainers/postgresql
```
В core `index.ts`: `export * from './testing/postgres.testcontainer'; export * from './testing/seed-identity'; export * from './testing/test-config';`

- [ ] **Step 2: Тесты (transport.e2e-spec.ts)**

Обязательный набор (каждый — отдельный `it`, код по образцу health.e2e + `app.inject`):
1. **join happy path:** 201; body `expect(tokenResponseSchema.parse(res.json()))` — валиден по SDK-схеме; `set-cookie` содержит `mm_refresh=`, `HttpOnly`, `SameSite=Strict`, `Path=/auth`; access verify через `TokenService.verifyAccessToken` → claims `{kind:'GUEST', roomId}`.
2. **неверный код → 403 `{code:'ROOM_JOIN_DENIED'}`**, body ровно `{code}` (нет message/stack — REQ-SEC-006).
3. **закрытая политика (`registered`) → ответ ИДЕНТИЧЕН неверному коду** (REQ-ID-013 на проводе): `expect(resClosed.statusCode).toBe(resWrong.statusCode); expect(resClosed.body).toBe(resWrong.body);`
4. **невалидное тело → 400 `{code:'REQUEST_INVALID'}`** (напр. `{code:'ABCDEFGH'}` без displayName).
5. **join rate limit:** boot с `JOIN_RATE_LIMIT_IP=2` → третий join → 429 `{code:'RATE_LIMITED'}`.
6. **лимит участников:** boot с `ROOM_PARTICIPANT_LIMIT=1` → второй гость → 409 `{code:'ROOM_PARTICIPANT_LIMIT_REACHED'}`.
7. **refresh happy:** join → `POST /auth/refresh` с кукой → 200, новый access, новая кука; старый refresh повторно → 401 `{code:'SESSION_INVALID'}`; НОВЫЙ refresh после повторного старого → тоже 401 (семейство ревокнуто, REQ-ID-007 сквозь провод).
8. **refresh без куки → 401 `{code:'SESSION_INVALID'}`**.
9. **refresh rate limit:** boot с `REFRESH_RATE_LIMIT=1` → второй refresh → 429 `{code:'RATE_LIMITED'}`.
10. **helmet:** ответ join содержит security-заголовки (напр. `x-dns-prefetch-control`).
11. **CORS:** запрос с `Origin: https://evil.example` → нет `access-control-allow-origin`; при `CORS_ORIGINS=https://ok.example` и этом origin — есть.
12. **терминальная комната:** join → room COMPLETED (через `RoomService`) → refresh → 401 (REQ-ID-016 на проводе).

Куку между запросами передавать вручную: `res.cookies` из ответа → заголовок `cookie` следующего запроса.

- [ ] **Step 3: Прогнать — зелёно**

Run: `pnpm build && pnpm --filter @mymozhem/server test`
(Требует Docker Desktop. `jest.setTimeout(120_000)` в файле.)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts apps/server
git commit -m "test(server): transport e2e — join/refresh flows, REQ-ID-013 indistinguishability, REQ-SEC-006 wire contract"
```

---

### Task 11: Seed-скрипт создания комнаты служебным организатором

**REQ:** REQ-SEC-001 (CLI, не HTTP-путь; токены организатору не выдаются), REQ-ID-005.

**Files:**
- Create: `apps/server/scripts/create-room.mjs`
- Modify: `apps/server/package.json` (script `create-room`)
- Modify: корневой `package.json` (script `create-room`)

- [ ] **Step 1: Скрипт**

`apps/server/scripts/create-room.mjs`:
```js
// CLI-создание комнаты служебным организатором к первому живому событию (design §8).
// Живой путь через core-сервисы: валидации, код комнаты, организаторская membership,
// lifecycle-эмит — всё штатно. НЕ HTTP-путь и не демо-auth (REQ-SEC-001): токены
// организатору не выдаются нигде.
// Usage: pnpm create-room -- --email=org@example.com [--policy=guests]
// Env: DATABASE_URL, JWT_SECRET (единая config-схема валидирует всё, REQ-OPS-003).
// Требует собранный @mymozhem/core (pnpm build).
import 'reflect-metadata';
import {
  loadConfig,
  PrismaService,
  IdentityService,
  MembershipService,
  JoinRateLimiter,
  EventLogService,
  AppRegistryService,
  RoomService,
} from '@mymozhem/core';

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const email = arg('email', 'organizer@mymozhem.local');
const policy = arg('policy', 'guests');

const config = loadConfig(process.env);
const prisma = new PrismaService();
await prisma.onModuleInit();
try {
  const identity = new IdentityService(prisma);
  const membership = new MembershipService(prisma, identity, new JoinRateLimiter(config.JOIN_RATE_LIMIT_IP), config);
  const rooms = new RoomService(prisma, new EventLogService(), new AppRegistryService([]), membership, config);

  let organizer = await prisma.identity.findFirst({ where: { email, kind: 'REGISTERED', deletedAt: null } });
  organizer ??= await prisma.identity.create({ data: { kind: 'REGISTERED', email } });

  const room = await rooms.create(organizer.id, policy);
  console.log(`Room created: id=${room.id} code=${room.code} joinPolicy=${room.joinPolicy} organizer=${organizer.id}`);
} finally {
  await prisma.onModuleDestroy();
}
```

`apps/server/package.json` scripts: `"create-room": "node scripts/create-room.mjs"`. Корневой `package.json` scripts: `"create-room": "pnpm --filter @mymozhem/server run create-room"`.

- [ ] **Step 2: Проверка на эфемерной БД (порт 55435, НЕ 5432)**

```bash
docker run -d --name mm-seed-check -e POSTGRES_PASSWORD=postgres -p 55435:5432 postgres:17
DATABASE_URL=postgresql://postgres:postgres@localhost:55435/postgres pnpm exec prisma migrate deploy
DATABASE_URL=postgresql://postgres:postgres@localhost:55435/postgres JWT_SECRET=$(openssl rand -hex 32) pnpm create-room -- --email=org@example.test
# ожидается строка "Room created: id=... code=... joinPolicy=guests ..."
# повторный прогон с тем же email — НЕ создаёт второго организатора (findFirst → reuse)
docker rm -f mm-seed-check
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/scripts apps/server/package.json package.json
git commit -m "feat(server): create-room CLI seed script via core services (REQ-SEC-001)"
```

---

### Task 12: Полные гейты + живой docker boot smoke

**Files:** только новые коммиты при находках.

- [ ] **Step 1: Полные ланы из корня**

```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm boundary-check && pnpm guardrails
```
Expected: всё зелёное. Docker Desktop запущен.

- [ ] **Step 2: Docker boot smoke**

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build -d
# /health/ready → 200; миграции применены (логи server или prisma migrate deploy в entrypoint — по факту Dockerfile)
curl -s -X POST localhost:3000/rooms/join -H 'content-type: application/json' -d '{"code":"NOPE1234","displayName":"Probe"}'
# ожидается: 403 {"code":"ROOM_JOIN_DENIED"} — транспорт + фильтр живы
docker compose down -v   # lt-pg не трогаем
```

- [ ] **Step 3: Обновить HANDOFF.md** (состояние среза, follow-ups: realtime-handshake берёт `TokenService.verify` + формат claims; OAuth-срез — REGISTERED-ветка; REQ-ID-010 sweep-джоб отложен). Commit.

---

## Spec coverage (сверка с дизайном)

| Дизайн § | Task |
|---|---|
| §3 компоненты (TransportModule, контроллеры, фильтр, AuthModule) | 4, 7, 8, 9 |
| §4 токен-модель + Session | 3, 4, 5 |
| §5 маппинг ошибок | 1 (коды), 7 |
| §6 контроли (real-IP, eviction, refresh-limit, helmet/CORS, uuid) | 6, 8, 9, 10 |
| §7 конфиг | 2 |
| §8 seed-скрипт | 11 |
| §9 тесты | 1, 2, 3, 4, 5, 6, 7, 10 |
| §0.3 parked minors (real-IP, eviction, uuid) | 9, 6, 7 |

## Follow-ups, которые этот план осознанно НЕ закрывает (фиксация для handoff)

- Realtime-handshake: берёт `TokenService.verifyAccessToken` + claims-формат как есть.
- OAuth-срез: `POST /rooms`, REGISTERED-ветка `TokenService` (без roomId-scope), Google-флоу.
- REQ-ID-010 (SHOULD): регламентный sweep просроченных сессий — таблица готова, джоб не строится.
- Access-revocation по `sid` (усиление после первого события, дизайн §11).
- appSettings follow-ups для configure-го транспорта (guard на null settings и пр.) — когда configure получит HTTP.
