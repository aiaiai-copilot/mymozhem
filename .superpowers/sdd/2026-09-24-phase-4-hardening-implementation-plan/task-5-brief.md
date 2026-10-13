### Task 5: Инструментация realtime (gauge / счётчик фиксации / гистограммы)

**Закрывает:** REQ-OPS-004 (точки измерения). Дизайн §3; Review Focus 1, 3.

**Files:**
- Modify: `packages/core/src/realtime/subscription-registry.ts`
- Modify: `packages/core/src/realtime/subscription-registry.spec.ts`
- Modify: `packages/core/src/realtime/event-outbox.ts`
- Modify: `packages/core/src/realtime/event-outbox.int-spec.ts`
- Modify: `packages/core/src/realtime/realtime.gateway.ts`
- Modify: `packages/core/src/realtime/realtime.gateway.spec.ts`
- Modify: `packages/core/src/realtime/realtime.module.ts`

**Interfaces:**
- Consumes: `MetricsService`, `MetricsModule` (Task 4).
- Produces: `new SubscriptionRegistry(metrics: MetricsService)` (конструктор с параметром); `new EventOutbox(prisma, bus, metrics)`; `RealtimeGateway` — `metrics: MetricsService` **последним** параметром конструктора (после `config`); `RealtimeModule` импортирует `MetricsModule`.

- [ ] **Step 1: RED — registry gauge (unit)**

`subscription-registry.spec.ts`: конструирование перевести на `new SubscriptionRegistry(metrics)`, где в начале файла:

```ts
const makeMetrics = () => ({
  connectionAdded: jest.fn(),
  connectionRemoved: jest.fn(),
}) as unknown as MetricsService; // import type { MetricsService } from '../observability/metrics.service';
```

Добавить тест:

```ts
it('gauge: add инкрементирует, remove декрементирует, remove несуществующего — no-op (Review Focus 1)', () => {
  const metrics = makeMetrics();
  const registry = new SubscriptionRegistry(metrics);
  registry.add({ socketId: 's1', identityId: 'i1', roomId: 'r1', level: 'public' });
  expect(metrics.connectionAdded).toHaveBeenCalledWith('r1');
  registry.remove('s1');
  expect(metrics.connectionRemoved).toHaveBeenCalledWith('r1');
  registry.remove('s1'); // повтор — без декремента
  expect((metrics.connectionRemoved as jest.Mock).mock.calls).toHaveLength(1);
});
```

- [ ] **Step 2: GREEN — registry**

`subscription-registry.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { MetricsService } from '../observability/metrics.service';
import type { OutwardLevel } from './projection.service';

// ...интерфейс Subscription без изменений...

@Injectable()
export class SubscriptionRegistry {
  private readonly bySocket = new Map<string, Subscription>();
  private readonly socketsByMembership = new Map<string, Set<string>>();

  // REQ-OPS-004: gauge активных соединений живёт здесь, а не в gateway — все
  // пути очистки (disconnect, mid-subscribe cleanup, catch-пути, revoke) идут
  // через remove(), и парность инкремент/декремент гарантирована построением.
  constructor(private readonly metrics: MetricsService) {}

  // key(), get(), socketsOf() — без изменений.

  add(sub: Subscription): void {
    this.bySocket.set(sub.socketId, sub);
    const key = SubscriptionRegistry.key(sub.identityId, sub.roomId);
    const set = this.socketsByMembership.get(key) ?? new Set<string>();
    set.add(sub.socketId);
    this.socketsByMembership.set(key, set);
    this.metrics.connectionAdded(sub.roomId);
  }

  remove(socketId: string): void {
    const sub = this.bySocket.get(socketId);
    if (sub === undefined) return;
    this.bySocket.delete(socketId);
    const key = SubscriptionRegistry.key(sub.identityId, sub.roomId);
    const set = this.socketsByMembership.get(key);
    set?.delete(socketId);
    if (set?.size === 0) this.socketsByMembership.delete(key);
    this.metrics.connectionRemoved(sub.roomId);
  }
}
```

- [ ] **Step 3: RED — счётчик ошибок фиксации (int)**

`event-outbox.int-spec.ts`: конструирование outbox — добавить третий аргумент `new MetricsService()` (импорт из `../observability/metrics.service`; в этом файле сервисы собираются вручную — поправить точку `new EventOutbox(prisma, bus)`); завести переменную `metrics: MetricsService`. Добавить describe/тесты:

```ts
it('откат tx по нетипизированному сбою инкрементирует mymozhem_event_commit_errors_total (REQ-OPS-004)', async () => {
  await expect(outbox.run(() => Promise.reject(new Error('db gone')))).rejects.toThrow('db gone');
  expect(await metrics.render()).toContain('mymozhem_event_commit_errors_total{code="UNKNOWN"} 1');
});

it('типизированный отказ (ContractError) — штатный отказ гейтов, счётчик не трогаем', async () => {
  await expect(
    outbox.run(() => Promise.reject(new ContractError('PRIZE_FUND_EXHAUSTED', 'x'))),
  ).rejects.toMatchObject({ code: 'PRIZE_FUND_EXHAUSTED' });
  expect(await metrics.render()).not.toContain('mymozhem_event_commit_errors_total');
});
```

- [ ] **Step 4: GREEN — outbox**

`event-outbox.ts`: импорты `import { ContractError } from '@mymozhem/sdk';`, `import { RealtimeError } from './realtime.errors';`, `import type { MetricsService } from '../observability/metrics.service';` (`Prisma` уже импортирован). Конструктор — третий параметр `private readonly metrics: MetricsService`. Метод `run`:

```ts
  async run<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (this.als.getStore() !== undefined) {
      throw new EventOutboxNestedRunError();
    }
    const store = { events: [] as LogEvent[] };
    let result: T;
    try {
      result = await this.prisma.$transaction((tx) => this.als.run(store, () => fn(tx)));
    } catch (err) {
      // REQ-OPS-004: откат tx по СБОЮ фиксации (БД, баг) — считаем. Типизированные
      // отказы домена (ContractError/RealtimeError) — штатные отказы гейтов, их
      // rollback — не сбой: не считаем (дизайн ф.4 §3).
      if (!(err instanceof ContractError) && !(err instanceof RealtimeError)) {
        this.metrics.incCommitError(commitErrorLabel(err));
      }
      throw err;
    }
    // Flush строго после resolves $transaction (см. комментарий ниже в исходнике).
    this.bus.publish(store.events);
    return result;
  }
```

И module-local хелпер рядом с классами ошибок:

```ts
// Label счётчика ошибок фиксации: P-код Prisma (ограниченное множество) либо UNKNOWN.
function commitErrorLabel(err: unknown): string {
  return err instanceof Prisma.PrismaClientKnownRequestError ? err.code : 'UNKNOWN';
}
```

- [ ] **Step 5: RED — гистограммы gateway (unit)**

`realtime.gateway.spec.ts`:
- В `makeGateway` добавить `fakeMetrics` и пробросить последним аргументом `new RealtimeGateway(...)`:

```ts
const fakeMetrics = {
  observePublishToDeliver: jest.fn(),
  observeReplayDuration: jest.fn(),
  connectionAdded: jest.fn(),
  connectionRemoved: jest.fn(),
  incCommitError: jest.fn(),
};
// ...в конструктор после config: `, fakeMetrics as never`
// (SubscriptionRegistry по умолчанию — new SubscriptionRegistry(fakeMetrics as never))
```

- Добавить тесты:

```ts
it('subscribe замеряет длительность replay (REQ-OPS-004)', async () => {
  const { gateway, metrics } = makeGateway({});
  const socket = fakeSocket();
  // через публичный handleSubscribe (паттерн существующих subscribe-тестов файла):
  await gateway.handleSubscribe(socket as never, { roomId: ROOM }, jest.fn() as never);
  expect(metrics.observeReplayDuration).toHaveBeenCalledWith('public', expect.any(Number));
});

it('fan-out замеряет publish→deliver по recordedAt события (REQ-OPS-004)', async () => {
  const { gateway, bus, metrics, server } = makeGateway({});
  gateway.afterInit(server as never);
  const listener = (bus.subscribe as jest.Mock).mock.calls[0][0] as (e: readonly unknown[]) => void;
  listener([
    {
      roomId: ROOM,
      seq: 1,
      type: 'quiz.question.opened',
      payload: {},
      actorId: null,
      visibility: 'PUBLIC',
      schemaVersion: 1,
      recordedAt: new Date(Date.now() - 120),
    },
  ]);
  expect(metrics.observePublishToDeliver).toHaveBeenCalledWith('public', expect.any(Number));
  expect((metrics.observePublishToDeliver as jest.Mock).mock.calls[0][1]).toBeGreaterThanOrEqual(0.1);
});
```

(`makeGateway` дополнить возвратом `metrics`, `bus`, `server`-фейком — по фактической структуре файла; server-фейк: `{ use: jest.fn(), on: jest.fn(), to: jest.fn().mockReturnValue({ emit: jest.fn() }), sockets: { sockets: new Map() } }`.)

- [ ] **Step 6: GREEN — gateway**

`realtime.gateway.ts`:
- Импорт `import { MetricsService } from '../observability/metrics.service';`
- Конструктор — последний параметр `private readonly metrics: MetricsService`.
- В `handleSubscribe` — обернуть чтение лога и сборку snapshot:

```ts
      const replayStart = performance.now();
      const events = await this.prisma.logEvent.findMany({
        where: { roomId },
        orderBy: { seq: 'asc' },
      });
      // ...manifest/snapshot как было...
      // REQ-OPS-004: длительность replay = чтение лога + построение snapshot.
      this.metrics.observeReplayDuration(level, (performance.now() - replayStart) / 1000);
```

- В `fanOut` после успешного `emit` каждого события:

```ts
        // REQ-OPS-004: латентность publish→deliver от коммита (recordedAt — DB now()).
        this.metrics.observePublishToDeliver(
          event.visibility.toLowerCase(),
          (Date.now() - event.recordedAt.getTime()) / 1000,
        );
```

(внутри `try` после веток `if/else if` с emit; для MODULE_PRIVATE ветки emit нет — замер не делаем, доставки нет.)

- [ ] **Step 7: RealtimeModule**

`realtime.module.ts`: импорт `import { MetricsModule } from '../observability/metrics.module';` и `MetricsModule` первым в `imports`.

- [ ] **Step 8: Прогоны — GREEN и регрессия**

Run: `pnpm --filter @mymozhem/core test -- realtime` → PASS (registry/gateway/projection/bus спеки).
Run: `pnpm --filter @mymozhem/core test:int -- event-outbox.int-spec` → PASS.
Run: `pnpm --filter @mymozhem/core test:int` → PASS (все int-ланы: деревья с RealtimeModule получают MetricsModule транзитивно).
Run: `pnpm build && pnpm run boundary-check` → зелёные.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/realtime/ packages/core/src/index.ts
git commit -m "feat(realtime): instrument REQ-OPS-004 metrics — connections gauge, commit errors, publish→deliver, replay"
```

---

