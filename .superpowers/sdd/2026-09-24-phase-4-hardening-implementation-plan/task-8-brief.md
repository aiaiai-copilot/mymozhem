### Task 8: Миграция логирования на pino + корреляция roomId/actorId

**Закрывает:** REQ-OPS-004 (логи — потребители и корреляция). Дизайн §2 («не две стеки»). 

**Files:**
- Modify: `packages/core/src/identity/guest-sweep.service.ts`
- Modify: `packages/core/src/identity/identity-sweep.module.ts`
- Modify: `packages/core/src/identity/identity.module.ts`
- Modify: `packages/core/src/membership/membership.service.ts`
- Modify: `packages/core/src/membership/membership.module.ts`
- Modify: `packages/core/src/realtime/realtime.gateway.ts`
- Modify: `packages/core/src/realtime/realtime.gateway.spec.ts`
- Modify: `packages/core/src/realtime/realtime.module.ts`
- Modify: `packages/core/src/transport/http-exception.filter.ts`
- Modify: `packages/core/src/transport/http-exception.filter.spec.ts`
- Modify: `packages/core/src/transport/transport.module.ts`

**Interfaces:**
- Consumes: `PinoLoggerModule`, `PINO_STREAM` (Task 7); `MetricsService` в gateway (Task 5).
- Produces: все 5 прежних точек `new Logger(...)` — на инжектированном `PinoLogger` (setContext в конструкторе); модули Identity/Membership/Realtime/Transport/IdentitySweep импортируют `PinoLoggerModule` (по ссылке). Логи операционных точек несут поля `{ roomId, actorId }`/`{ socketId }` там, где значения уже есть в скоупе.

- [ ] **Step 1: RED — спеки на новые конструкторы и поля**

`realtime.gateway.spec.ts` (`makeGateway`): добавить `fakeLogger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }` и пробросить **последним** аргументом конструктора (после metrics). Новый тест:

```ts
it('subscribe-лог несёт корреляцию socketId/actorId/roomId, payload не логируется (REQ-OPS-004, REQ-SEC-009)', async () => {
  const { gateway, logger } = makeGateway({});
  const socket = fakeSocket();
  await gateway.handleSubscribe(socket as never, { roomId: ROOM }, jest.fn() as never);
  expect(logger.info).toHaveBeenCalledWith(
    expect.objectContaining({ socketId: 'socket-1', actorId: GUEST_CLAIMS.sub, roomId: ROOM }),
    expect.any(String),
  );
  const logged = JSON.stringify((logger.info as jest.Mock).mock.calls);
  expect(logged).not.toContain('payload');
});
```

`http-exception.filter.spec.ts`: `makeFilter` → `new HttpExceptionFilter(fakeLogger)` с `fakeLogger = { setContext: jest.fn(), error: jest.fn(), warn: jest.fn() }`; `makeHost` дополнить `getRequest: () => ({ id: 'req-1' })`; шпионы `Logger.prototype` (Nest) удалить — вместо них ассерты на `fakeLogger`. Добавить кейс:

```ts
it('5xx-лог несёт requestId из запроса (REQ-OPS-004)', () => {
  const { filter, reply, logger } = makeFilter();
  filter.catch(new Error('boom'), makeHost(reply) as never);
  expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-1' }), expect.any(String));
});
```

Run обе спеки → FAIL (конструкторы/поля не совпадают).

- [ ] **Step 2: GREEN — фильтр**

`http-exception.filter.ts`:
- Импорты: убрать `Logger` из `@nestjs/common`; `import { PinoLogger } from 'nestjs-pino';`
- Заменить поле на конструктор:

```ts
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(HttpExceptionFilter.name);
  }
```

- В `catch`: читать запрос и логировать с requestId:

```ts
    const req = host.switchToHttp().getRequest<{ id?: string }>();
    const requestId = req.id;
    // ...
    if (status >= 500) {
      this.logger.error({ requestId, err: exception }, 'request failed');
    } else if (exception instanceof AuthError || exception instanceof OAuthError) {
      this.logger.warn({ requestId }, exception.message);
    }
```

(Комментарий про «различие reuse/expired обязан нести серверный лог» — сохранить.)

- [ ] **Step 3: GREEN — gateway**

`realtime.gateway.ts`:
- Убрать `Logger` из импортов `@nestjs/common`, `import { PinoLogger } from 'nestjs-pino';`
- Конструктор — последний параметр `private readonly logger: PinoLogger` (после `metrics`); тело конструктора: `this.logger.setContext(RealtimeGateway.name);` (удалить поле `private readonly logger = new Logger(...)`).
- `authenticate`: warn → `this.logger.warn({ socketId: socket.id }, \`socket auth failed: ${(err as Error).message}\`);`
- В `server.on('connection', …)` — операционные логи:

```ts
    server.on('connection', (socket) => {
      this.logger.info({ socketId: socket.id, actorId: claimsOf(socket).sub }, 'socket connected');
      socket.on(REALTIME_MESSAGES.SUBSCRIBE, ...); // как было
      socket.on(REALTIME_MESSAGES.PUBLISH, ...);    // как было
      socket.on('disconnect', () => {
        this.logger.info({ socketId: socket.id }, 'socket disconnected');
        this.registry.remove(socket.id);
      });
    });
```

- В `handleSubscribe` после `ack({ ok: true, snapshot })`:

```ts
      this.logger.info(
        { socketId: socket.id, actorId: claims.sub, roomId, level },
        'subscribed',
      );
```

(перед ним сам `ack` — порядок: лог после ack, чтобы ack не задерживать).
- `fanOut` catch: `this.logger.error({ roomId: event.roomId, seq: event.seq, type: event.type, err }, 'fan-out failed');` (payload НЕ логируется — REQ-SEC-009).
- `wireCodeOf`: `this.logger.error({ err }, 'unmapped realtime error');`

- [ ] **Step 4: GREEN — sweep / scheduler / membership**

`guest-sweep.service.ts`: PinoLogger (setContext), логи:
- успех: `this.logger.info({ anonymized: anonymized.count, suspended: suspended.size }, 'guest sweep');`
- откат C-8.1: `this.logger.warn({ raced: err.racedCount }, 'guest sweep rolled back: concurrent award (C-8.1)');`

`identity-sweep.module.ts` (GuestSweepScheduler): PinoLogger; catch: `this.logger.error({ err }, 'guest sweep failed');`

`membership.service.ts`: PinoLogger (setContext) вместо `new Logger`; существующее сообщение (строка ~163, error-лог слушателя `onAccessRevoked`) — сохранить текст, добавить поля из скоупа (`identityId`, `roomId` — что есть в точке вызова). Новых логов не добавлять.

- [ ] **Step 5: Импорты модулей**

В `imports` добавить `PinoLoggerModule` (импорт из `../observability/pino-logger.module`):
- `identity.module.ts`
- `identity-sweep.module.ts`
- `membership.module.ts`
- `realtime.module.ts`
- `transport.module.ts`

- [ ] **Step 6: Прогоны — GREEN и регрессия всех затронутых лан**

Run: `pnpm --filter @mymozhem/core test` → PASS (gateway/filter/registry спеки).
Run: `pnpm --filter @mymozhem/core test:int` → PASS (guest-sweep, membership, realtime, rewards, observability — DI-деревья получают PinoLogger транзитивно).
Run: `pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core lint` → зелёные.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/identity/ packages/core/src/membership/ packages/core/src/realtime/ packages/core/src/transport/
git commit -m "refactor(core): migrate logging to pino with requestId/roomId/actorId correlation (REQ-OPS-004)"
```

---

