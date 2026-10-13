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

