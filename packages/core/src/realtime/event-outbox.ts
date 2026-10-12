import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { Prisma, type LogEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../observability/metrics.service';
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

// Label счётчика ошибок фиксации; undefined — не считать (типизированный отказ).
// Конвенция кодабазы: типизированная доменная ошибка несёт строковый `code`
// (ContractError, RealtimeError, RoomError, MembershipError, AppRegistryError,
// IdentityError, AuthError и будущие иерархии) — её rollback штатный (дизайн
// ф.4 §3), счётчик не трогаем. Структурный предикат, а не instanceof: realtime не
// импортирует доменные иерархии (Ruling B-F.1). Порядок важен:
// PrismaClientKnownRequestError тоже несёт строковый code — ветка Prisma ДО
// структурной проверки (label = P-код, ограниченное множество). Принятый промах:
// Node/system-ошибки со строковым code (ENOENT и т.п.) вне обёртки Prisma тоже
// исключаются; сбои БД adapter-pg оборачивает в P2010 — теряем мало.
function commitErrorLabel(err: unknown): string | undefined {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code;
  if (typeof (err as { code?: unknown } | null)?.code === 'string') return undefined;
  return 'UNKNOWN';
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
    private readonly metrics: MetricsService,
  ) {}

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
      // отказы домена (string code, см. commitErrorLabel) — штатные отказы гейтов,
      // их rollback — не сбой: не считаем (дизайн ф.4 §3).
      const label = commitErrorLabel(err);
      if (label !== undefined) {
        this.metrics.incCommitError(label);
      }
      throw err;
    }
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
