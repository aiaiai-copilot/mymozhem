### Task 4: prom-client + MetricsModule (4 метрики REQ-OPS-004)

**Закрывает:** REQ-OPS-004 (метрики — ядро). Дизайн §3.

**Files:**
- Modify: `packages/core/package.json` (dep `prom-client`)
- Create: `packages/core/src/observability/metrics.service.ts`
- Create: `packages/core/src/observability/metrics.service.spec.ts`
- Create: `packages/core/src/observability/metrics.module.ts`
- Modify: `packages/core/src/index.ts` (barrel-экспорт)

**Interfaces:**
- Consumes: ничего из других задач.
- Produces (потребители — Tasks 5/6):
  - `class MetricsService` с методами: `observePublishToDeliver(visibility: string, seconds: number): void` (клэмп ≥ 0), `observeReplayDuration(level: string, seconds: number): void`, `incCommitError(code: string): void`, `connectionAdded(roomId: string): void`, `connectionRemoved(roomId: string): void`, `readonly contentType: string`, `render(): Promise<string>`.
  - `class MetricsModule` — `@Module({ providers: [MetricsService], exports: [MetricsService] })`.

- [ ] **Step 0: Зависимость**

Run: `pnpm --filter @mymozhem/core add prom-client@^15.1.3`
(Один lockfile — коммитим `pnpm-lock.yaml` вместе с кодом задачи.)

- [ ] **Step 1: RED — unit-спека `metrics.service.spec.ts`**

```ts
import { MetricsService } from './metrics.service';

// REQ-OPS-004: ровно 4 метрики дизайна §3; собственный Registry (не default) —
// спеки не загрязняют друг друга.
describe('MetricsService (REQ-OPS-004)', () => {
  it('экспонирует 4 метрики в Prometheus text format', async () => {
    const m = new MetricsService();
    m.observePublishToDeliver('public', 0.012);
    m.observeReplayDuration('organizer', 0.2);
    m.incCommitError('P2034');
    m.connectionAdded('room-1');

    const text = await m.render();

    expect(text).toContain('mymozhem_publish_to_deliver_seconds_count{visibility="public"} 1');
    expect(text).toContain('mymozhem_replay_duration_seconds_count{level="organizer"} 1');
    expect(text).toContain('mymozhem_event_commit_errors_total{code="P2034"} 1');
    expect(text).toContain('mymozhem_active_connections{roomId="room-1"} 1');
    expect(m.contentType).toContain('text/plain');
  });

  it('gauge: парные add/remove; серия комнаты исчезает при нуле (stale-series гигиена)', async () => {
    const m = new MetricsService();
    m.connectionAdded('room-1');
    m.connectionAdded('room-1');
    m.connectionRemoved('room-1');
    expect(await m.render()).toContain('mymozhem_active_connections{roomId="room-1"} 1');
    m.connectionRemoved('room-1');
    expect(await m.render()).not.toContain('mymozhem_active_connections{roomId="room-1"}');
    // remove без add — не уводит в минус:
    m.connectionRemoved('room-1');
    expect(await m.render()).not.toContain('mymozhem_active_connections{roomId="room-1"}');
  });

  it('publish→deliver зажимается в 0 при skew часов (recordedAt БД впереди Date.now())', async () => {
    const m = new MetricsService();
    m.observePublishToDeliver('public', -5);
    const text = await m.render();
    expect(text).toContain('mymozhem_publish_to_deliver_seconds_count{visibility="public"} 1');
    expect(text).toContain('mymozhem_publish_to_deliver_seconds_sum{visibility="public"} 0');
  });
});
```

Run: `pnpm --filter @mymozhem/core test -- metrics.service.spec` → FAIL (модуля нет).

- [ ] **Step 2: GREEN — `metrics.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

// REQ-OPS-004 (ф.4, дизайн 2026-09-24 §3): 4 метрики наблюдаемости. Собственный
// Registry (не default registry prom-client) — изоляция тестов; состояние —
// поля экземпляра (REQ-CORE-004). Сервис беззависимостный: конструируется и
// вручную в unit-спеках потребителей.
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  private readonly publishToDeliver = new Histogram({
    name: 'mymozhem_publish_to_deliver_seconds',
    help: 'Latency from log-event commit (recordedAt) to live delivery to subscribers',
    labelNames: ['visibility'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  private readonly replayDuration = new Histogram({
    name: 'mymozhem_replay_duration_seconds',
    help: 'Duration of room-log replay during subscribe (log read + snapshot build)',
    labelNames: ['level'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [this.registry],
  });

  private readonly commitErrors = new Counter({
    name: 'mymozhem_event_commit_errors_total',
    help: 'Event-commit transactions rolled back by an untyped failure (typed domain rejections excluded)',
    labelNames: ['code'],
    registers: [this.registry],
  });

  private readonly activeConnections = new Gauge({
    name: 'mymozhem_active_connections',
    help: 'Active realtime subscriptions per room',
    labelNames: ['roomId'],
    registers: [this.registry],
  });

  // Счётчики по комнатам — свои (не читаем prom-client обратно): dec без add и
  // уборка stale-серий при нуле детерминированы.
  private readonly connectionCounts = new Map<string, number>();

  observePublishToDeliver(visibility: string, seconds: number): void {
    // recordedAt — часы БД, Date.now() — часы приложения: при skew возможен
    // отрицательный интервал, гистограмме он не нужен.
    this.publishToDeliver.observe({ visibility }, Math.max(0, seconds));
  }

  observeReplayDuration(level: string, seconds: number): void {
    this.replayDuration.observe({ level }, Math.max(0, seconds));
  }

  incCommitError(code: string): void {
    this.commitErrors.inc({ code });
  }

  connectionAdded(roomId: string): void {
    const next = (this.connectionCounts.get(roomId) ?? 0) + 1;
    this.connectionCounts.set(roomId, next);
    this.activeConnections.set({ roomId }, next);
  }

  connectionRemoved(roomId: string): void {
    const next = (this.connectionCounts.get(roomId) ?? 0) - 1;
    if (next <= 0) {
      // Не копим серии завершённых комнат со значением 0 (кардинальность = живым комнатам).
      this.connectionCounts.delete(roomId);
      this.activeConnections.remove(roomId);
      return;
    }
    this.connectionCounts.set(roomId, next);
    this.activeConnections.set({ roomId }, next);
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
```

- [ ] **Step 3: `metrics.module.ts` + barrel**

```ts
import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';

// Листовой модуль наблюдаемости (boundary observability-is-leaf, Task 6):
// доменные модули импортируют его, сам он доменных не знает.
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
```

`packages/core/src/index.ts` — добавить строки (рядом с прочими module-экспортами):

```ts
export * from './observability/metrics.module';
export * from './observability/metrics.service';
```

- [ ] **Step 4: Запустить — GREEN + гейты**

Run: `pnpm --filter @mymozhem/core test -- metrics.service.spec` → PASS.
Run: `pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core lint` → зелёные.

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/observability/ packages/core/src/index.ts
git commit -m "feat(core): observability MetricsModule — 4 метрики REQ-OPS-004 (prom-client)"
```

---

