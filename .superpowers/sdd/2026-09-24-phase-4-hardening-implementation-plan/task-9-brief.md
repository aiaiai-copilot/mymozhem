### Task 9: Composition root + e2e-приёмка наблюдаемости

**Закрывает:** REQ-OPS-004 (e2e-приёмка), REQ-OPS-003 (boot). Дизайн §5; Review Focus 5.

**Files:**
- Modify: `packages/core/src/observability/observability.module.ts` (+PinoLoggerModule)
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/package.json` (dep `nestjs-pino`)
- Modify: `packages/core/src/observability/observability.int-spec.ts` (pino-stream сценарий)
- Modify: `apps/server/test/transport.e2e-spec.ts` (x-request-id)
- Modify: `apps/server/test/realtime.e2e-spec.ts` (метрики на проводе)

**Interfaces:**
- Consumes: всё из Tasks 4–8.
- Produces: `AppModule` включает `ObservabilityModule`; `main.ts` — `app.useLogger(app.get(Logger))`; e2e-ассерты приёмки.

- [ ] **Step 0: Зависимость apps/server**

Run: `pnpm --filter @mymozhem/server add nestjs-pino@^4.4.0`

- [ ] **Step 1: RED — pino-stream сценарий в `observability.int-spec.ts`**

Дополнить существующий файл: в дерево тестового модуля провайдер `{ provide: PINO_STREAM, useValue: logBuffer }`, где

```ts
import { Writable } from 'node:stream';

const logLines: string[] = [];
const logBuffer = new Writable({
  write(chunk, _enc, cb) {
    logLines.push(chunk.toString());
    cb();
  },
});
```

Тест:

```ts
it('строка лога запроса — JSON с requestId; authorization/cookie замаскированы (Review Focus 5)', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/metrics',
    headers: { authorization: 'Bearer SECRET-TOKEN', cookie: 'mm_refresh=SECRET-COOKIE' },
  });
  expect(res.statusCode).toBe(200);
  const requestId = res.headers['x-request-id'];
  const line = logLines.map((l) => l.trim()).filter((l) => l.includes('"req"')).pop();
  expect(line).toBeDefined();
  const parsed = JSON.parse(line!);
  expect(parsed.req.id).toBe(requestId);
  expect(line).not.toContain('SECRET-TOKEN');
  expect(line).not.toContain('SECRET-COOKIE');
});
```

- [ ] **Step 2: GREEN — wiring**

`observability.module.ts`: в `imports` добавить `PinoLoggerModule` (первым, из `./pino-logger.module`).

`apps/server/src/app.module.ts`: импорт `ObservabilityModule` из `@mymozhem/core`; в `imports` — сразу после `HealthModule`.

`apps/server/src/main.ts`:
- Импорт `import { Logger } from 'nestjs-pino';`
- Сразу после `NestFactory.create(...)`:

```ts
  // REQ-OPS-004: системные логи Nest — тоже через pino (единая стека).
  app.useLogger(app.get(Logger));
```

- [ ] **Step 3: Прогон int — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- observability.int-spec` → PASS.

- [ ] **Step 4: RED/GREEN — e2e `transport.e2e-spec.ts`**

Добавить в существующий describe (бут изменить не нужно — e2e зеркалит main.ts и собирает AppModule; `useLogger` там не вызывается, но LoggerModule в дереве есть через AppModule):

```ts
it('ответ несёт x-request-id (REQ-OPS-004)', async () => {
  const res = await app.inject({ method: 'GET', url: '/health/live' });
  expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
```

Run: `pnpm build && pnpm --filter @mymozhem/server test -- transport.e2e` → PASS.

- [ ] **Step 5: RED/GREEN — e2e `realtime.e2e-spec.ts`: метрики на проводе**

Новый сценарий (стиль файла: сокеты через реальный listen, HTTP — `app.inject`):

```ts
it('/metrics отражает realtime-жизнь комнаты: gauge, replay, publish→deliver (REQ-OPS-004)', async () => {
  // комната+гость+сокет — существующими хелперами файла (join → access token → io())
  // ...подключить сокет, дождаться subscribe-ack...
  const duringRes = await app.inject({ method: 'GET', url: '/metrics' });
  expect(duringRes.statusCode).toBe(200);
  expect(duringRes.body).toContain(`mymozhem_active_connections{roomId="${roomId}"} 1`);
  expect(duringRes.body).toContain('mymozhem_replay_duration_seconds_count{level="public"} 1');

  // publish app-события (существующий сценарий файла — quiz.question.opened организатором
  // либо доступный клиентский тип) → ack ok → fan-out
  // ...
  const afterPublish = await app.inject({ method: 'GET', url: '/metrics' });
  expect(afterPublish.body).toContain('mymozhem_publish_to_deliver_seconds_count{visibility="public"} 1');

  socket.close();
  // дождаться обработки disconnect (poll /metrics до исчезновения серии, ≤ 2 с):
  await expect
    .poll(async () => (await app.inject({ method: 'GET', url: '/metrics' })).body, { timeout: 2000 })
    .not.toContain(`mymozhem_active_connections{roomId="${roomId}"}`);
});
```

(`expect.poll` — vitest-форма, в jest использовать ручной цикл ожидания с таймаутом по прецеденту waitEventWhere файла; суть ассерта — серия комнаты исчезает после disconnect.)

Run: `pnpm build && pnpm --filter @mymozhem/server test -- realtime.e2e` → PASS.

- [ ] **Step 6: Полные гейты конвейера**

Run: `pnpm build && pnpm run boundary-check && pnpm run guardrails && pnpm run lint && pnpm run typecheck && pnpm run test && pnpm --filter @mymozhem/core test:int && pnpm --filter @mymozhem/server test`
Expected: всё зелёное.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/observability/ apps/server/ pnpm-lock.yaml
git commit -m "feat(server): wire observability — /metrics, pino system logger, e2e acceptance (REQ-OPS-004)"
```

---

