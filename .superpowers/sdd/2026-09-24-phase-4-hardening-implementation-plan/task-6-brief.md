### Task 6: `GET /metrics` + boundary-правила observability

**Закрывает:** REQ-OPS-004 (экспозиция), REQ-DEV-001 (boundary новых правил). Дизайн §3, §6.

**Files:**
- Create: `packages/core/src/observability/metrics.controller.ts`
- Create: `packages/core/src/observability/observability.module.ts`
- Create: `packages/core/src/observability/observability.int-spec.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `.dependency-cruiser.cjs`
- Modify: `scripts/verify-guardrails.mjs`

**Interfaces:**
- Consumes: `MetricsService`, `MetricsModule` (Task 4).
- Produces: `ObservabilityModule` (imports `MetricsModule`, controllers `[MetricsController]`) — экспортирован из barrel core; `GET /metrics` → 200, body Prometheus text format, Content-Type из registry. Правила depcruise `observability-is-leaf` и `observability-libs-contained` (+2 probe в guardrails).

- [ ] **Step 1: RED — int-спека `observability.int-spec.ts`**

Бутстрап — по образцу `rewards.controller.int-spec.ts` (fastify-адаптер, `Test.createTestingModule`, override APP_CONFIG на TEST_CONFIG; БД не нужна — контроллер читает только registry). Дерево: `ConfigModule, ObservabilityModule`. Тесты:

```ts
it('GET /metrics — 200, text format, 4 метрики REQ-OPS-004', async () => {
  const metrics = moduleRef.get(MetricsService);
  metrics.connectionAdded('11111111-1111-4111-8111-111111111111');
  const res = await app.inject({ method: 'GET', url: '/metrics' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain('text/plain');
  expect(res.body).toContain('mymozhem_active_connections{roomId="11111111-1111-4111-8111-111111111111"} 1');
  expect(res.body).toContain('mymozhem_publish_to_deliver_seconds');
  expect(res.body).toContain('mymozhem_replay_duration_seconds');
  expect(res.body).toContain('mymozhem_event_commit_errors_total');
});

it('GET /metrics не требует авторизации (открытый — решение владельца, дизайн §0.3)', async () => {
  const res = await app.inject({ method: 'GET', url: '/metrics' }); // без заголовков
  expect(res.statusCode).toBe(200);
});
```

- [ ] **Step 2: Запустить — RED**

Run: `pnpm --filter @mymozhem/core test:int -- observability.int-spec`
Expected: FAIL (модулей нет).

- [ ] **Step 3: GREEN — контроллер и модуль**

`metrics.controller.ts`:

```ts
import { Controller, Get, Res } from '@nestjs/common';
import { MetricsService } from './metrics.service';

// Core не знает fastify (ReplyLike-прецедент http-exception.filter): структурный
// минимум ответа; FastifyReply совместим по форме.
interface MetricsReply {
  header(name: string, value: string): unknown;
  send(body: string): unknown;
}

// REQ-OPS-004: экспозиция Prometheus text format. Открытый (решение владельца,
// дизайн ф.4 §0.3) — как /health; авторизация и CORS-гейты не применяются.
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  async getMetrics(@Res() reply: MetricsReply): Promise<void> {
    reply.header('Content-Type', this.metrics.contentType);
    reply.send(await this.metrics.render());
  }
}
```

`observability.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsModule } from './metrics.module';

// Фасад наблюдаемости (ф.4): /metrics + (батч C) pino-конфигурация. Листовой —
// доменные модули импортируют его, не наоборот (observability-is-leaf).
@Module({
  imports: [MetricsModule],
  controllers: [MetricsController],
  exports: [MetricsModule],
})
export class ObservabilityModule {}
```

`packages/core/src/index.ts` — добавить:

```ts
export * from './observability/observability.module';
```

- [ ] **Step 4: Запустить — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- observability.int-spec` → PASS.

- [ ] **Step 5: Boundary-правила `.dependency-cruiser.cjs`**

В `forbidden` добавить два правила:

```js
    {
      name: 'observability-is-leaf',
      comment:
        'core/observability — лист: не импортирует доменные модули ядра ' +
        '(REQ-OPS-004, дизайн ф.4 §6; доменные импортируют его, не наоборот). ' +
        'config — инфраструктурное исключение (APP_CONFIG для pino-фабрики).',
      severity: 'error',
      from: { path: '^packages/core/src/observability', pathNot: '[.]spec[.]ts$' },
      to: {
        path: '^packages/core/src',
        pathNot: ['^packages/core/src/observability', '^packages/core/src/config'],
      },
    },
    {
      name: 'observability-libs-contained',
      comment:
        'Библиотеки наблюдаемости (nestjs-pino/pino/pino-http/prom-client) импортируются ' +
        'только в core/observability, barrel core и bootstrap apps/server (дизайн ф.4 §6).',
      severity: 'error',
      from: {
        pathNot: [
          '^packages/core/src/observability',
          '^packages/core/src/index[.]ts$',
          '^apps/server/src/main[.]ts$',
          '[/\\\\]dist[/\\\\]',
        ],
      },
      to: { path: 'node_modules/(nestjs-pino|pino-http|prom-client|pino)[/\\\\]' },
    },
```

- [ ] **Step 6: Probes в `scripts/verify-guardrails.mjs`**

Два новых probe-файла (запись рядом с существующими, удаление в `finally`):

```js
// 9) Observability-leaf probe: observability импортирует доменный модуль
// (forbidden: observability-is-leaf). Относительный импорт (прецедент probe 4).
const obsLeafProbe = 'packages/core/src/observability/__probe-leaf.ts';
writeFileSync(
  obsLeafProbe,
  "import '../room/room.module';\nexport const probe = 1;\n",
);

// 10) Observability-libs probe: prom-client вне observability
// (forbidden: observability-libs-contained). Пакетный spec — правило матчится
// по node_modules-пути резолва (прецедент probe 7).
const obsLibsProbe = 'packages/core/src/room/__probe-obs-libs.ts';
writeFileSync(
  obsLibsProbe,
  "import 'prom-client';\nexport const probe = 1;\n",
);
```

И два `expectFailure` в try-блок:

```js
  expectFailure(
    'observability → core domain import (dependency-cruiser)',
    `pnpm exec depcruise ${obsLeafProbe} --config .dependency-cruiser.cjs`,
    'observability-is-leaf',
  );
  expectFailure(
    'prom-client outside observability (dependency-cruiser)',
    `pnpm exec depcruise ${obsLibsProbe} --config .dependency-cruiser.cjs`,
    'observability-libs-contained',
  );
```

- [ ] **Step 7: Гейты**

Run: `pnpm run guardrails` → все 10 probes OK.
Run: `pnpm build && pnpm run boundary-check` → зелёные.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/observability/ packages/core/src/index.ts .dependency-cruiser.cjs scripts/verify-guardrails.mjs
git commit -m "feat(core): GET /metrics (open, REQ-OPS-004) + observability boundary rules and probes"
```

---

