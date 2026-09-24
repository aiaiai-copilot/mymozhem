import type { ProjectedEvent } from '@mymozhem/sdk';

// Фолд-модель клиента (дизайн §3): live до snapshot — в буфер; после snapshot —
// напрямую. Дуп из окна handshake (событие и в snapshot, и в буфере) структурно
// неотличим (wire без id/seq, REQ-RT-011a) — принят; лечится re-subscribe → reset +
// полный перефолд. Потеря события исключена.
export class LogStore {
  private snapshot: ProjectedEvent[] | null = null;
  private buffered: ProjectedEvent[] = [];
  private live: ProjectedEvent[] = [];

  pushLive(event: ProjectedEvent): void {
    (this.snapshot === null ? this.buffered : this.live).push(event);
  }
  applySnapshot(events: ProjectedEvent[]): void {
    this.snapshot = [...events];
  }
  reset(): void {
    this.snapshot = null;
    this.buffered = [];
    this.live = [];
  }
  all(): ProjectedEvent[] {
    return this.snapshot === null ? [] : [...this.snapshot, ...this.buffered, ...this.live];
  }
}
