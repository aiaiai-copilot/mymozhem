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
