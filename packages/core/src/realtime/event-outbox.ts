import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { LogEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeBus } from './realtime-bus';

// Внутренние ошибки механизма (design §5): обе означают баг вызывающего, на провод
// не маппятся (через gateway-фильтр уйдут как INTERNAL_ERROR).
export class EventOutboxMissingContextError extends Error {
  constructor() {
    super('commit*Event called outside EventOutbox.run: a committed event would have no delivery path');
    this.name = new.target.name;
  }
}

export class EventOutboxNestedRunError extends Error {
  constructor() {
    super('EventOutbox.run cannot be nested: Prisma has no nested interactive transactions');
    this.name = new.target.name;
  }
}

// Tx-scoped outbox (design §5, подход A): commit*Event складывает событие в
// ALS-контекст транзакции; run() после УСПЕШНОГО коммита отдаёт буфер в шину; при
// откате буфер умирает вместе с контекстом — откаченное событие недоставимо
// структурно. Контекста нет → fail-closed: «забыл доставить» исключено структурно.
@Injectable()
export class EventOutbox {
  private readonly als = new AsyncLocalStorage<{ events: LogEvent[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: RealtimeBus,
  ) {}

  async run<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (this.als.getStore() !== undefined) {
      throw new EventOutboxNestedRunError();
    }
    const store = { events: [] as LogEvent[] };
    const result = await this.prisma.$transaction((tx) => this.als.run(store, () => fn(tx)));
    // Flush строго после resolves $transaction: до этой строки события видны только
    // буферу — подписчики никогда не наблюдают то, что может откатиться.
    this.bus.publish(store.events);
    return result;
  }

  stage(event: LogEvent): void {
    const store = this.als.getStore();
    if (store === undefined) {
      throw new EventOutboxMissingContextError();
    }
    store.events.push(event);
  }
}
