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

