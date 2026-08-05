import { EventEmitter } from 'node:events';
import { Injectable } from '@nestjs/common';
import type { LogEvent } from '@prisma/client';

export type CommittedEventsListener = (events: readonly LogEvent[]) => void;

// In-process шина «событие закоммичено» (design §5): легальна при одной реплике
// (REQ-OPS-005); воссоздаваемость не нужна — события durable в логе, шина несёт
// только live-доставку. Состояние — поле экземпляра (REQ-CORE-004).
@Injectable()
export class RealtimeBus {
  private readonly emitter = new EventEmitter();

  publish(events: readonly LogEvent[]): void {
    if (events.length === 0) return;
    this.emitter.emit('committed', events);
  }

  subscribe(listener: CommittedEventsListener): void {
    this.emitter.on('committed', listener);
  }
}
