import {
  REALTIME_MESSAGES,
  contractErrorPayloadSchema,
  projectedEventSchema,
  publishOkAckSchema,
  publishRequestSchema,
  subscribeOkAckSchema,
  subscribeRequestSchema,
  type ProjectedEvent,
  type PublishRequest,
  type RoomSnapshot,
} from '@mymozhem/sdk';
import { ApiError } from '../api/api-error';
import type { SocketLike } from './socket-like';

export type ConnectionState = 'connecting' | 'live' | 'disconnected';

// Привязка сокета к одной комнате (дизайн §3): join → snapshot, live-поток →
// ProjectedEvent'ы, reconnect → полный перефолд через свежий snapshot в onResync.
// Всё, что приходит с провода, парсится схемами SDK: дрейф контракта — ZodError
// (fail-loud), ack-ошибка — ApiError с серверным кодом (статус 0: на wire-уровне
// HTTP-статуса нет).
export class RoomConnection {
  private joined = false;
  private refreshAttempted = false;
  private resyncCb: ((s: RoomSnapshot) => void) | null = null;
  private stateCb: ((s: ConnectionState) => void) | null = null;

  constructor(
    private readonly socket: SocketLike,
    private readonly roomId: string,
    // Refresh access-токена при отказе handshake (протухший TTL): инжектируется,
    // чтобы спека управляла успехом/провалом без реальной сети. Опционально —
    // без хука connect_error остаётся no-op'ом, как раньше.
    private readonly refreshAccessToken?: () => Promise<void>,
  ) {
    // Reconnect → re-subscribe → свежий snapshot в onResync (полный перефолд, дизайн §3).
    // Первый connect приходит до join() → joined=false → no-op (только состояние).
    this.socket.onConnect(() => {
      // Успешный handshake закрывает стрик обрыва: следующая серия отказов
      // снова имеет право на один refresh.
      this.refreshAttempted = false;
      this.stateCb?.(this.joined ? 'live' : 'connecting');
      if (this.joined) {
        // При ошибке subscribe gateway зачищает серверную подписку (registry.remove
        // + socket.leave), но НЕ разрывает соединение: без .catch состояние навсегда
        // осталось бы 'live' при мёртвой подписке и unhandled rejection. Поэтому
        // падение re-subscribe переводим в явный 'disconnected' (обрыв — явный
        // индикатор, дизайн §5); retry — забота потребителя по этому состоянию.
        void this.subscribeOnce()
          .then((s) => this.resyncCb?.(s))
          .catch(() => this.stateCb?.('disconnected'));
      }
    });
    this.socket.onConnectError(() => {
      // Handshake-отказ при ранее присоединённой комнате: типовой случай —
      // протухший за время сна телефона access-токен (gateway на любой
      // auth-отказ отвечает одинаковым SESSION_INVALID, причины на клиенте не
      // различить надёжно, поэтому не фильтруем по err). Без refresh socket.io
      // ретраил бы handshake со старым токеном бесконечно, а REST-401 (единственный
      // иной триггер refresh) никогда не наступил бы — вечный «Переподключаемся…».
      // Refresh — ровно один на стрик обрыва, иначе retry-шторм превратился бы
      // в refresh-шторм; после успешного refresh очередной retry socket.io
      // перечитает свежий токен через auth-колбэк сам. Провал refresh (мёртвая
      // refresh-кука) — явный 'disconnected', тот же контракт, что у упавшего
      // re-subscribe: дальше — re-join путь страницы.
      if (!this.joined || this.refreshAttempted || !this.refreshAccessToken) return;
      this.refreshAttempted = true;
      void this.refreshAccessToken().catch(() => this.stateCb?.('disconnected'));
    });
    this.socket.onDisconnect(() => this.stateCb?.('disconnected'));
  }

  onEvent(cb: (e: ProjectedEvent) => void): void {
    this.socket.onEvent((payload) => cb(projectedEventSchema.parse(payload)));
  }

  onResync(cb: (s: RoomSnapshot) => void): void {
    this.resyncCb = cb;
  }

  onStateChange(cb: (s: ConnectionState) => void): void {
    this.stateCb = cb;
  }

  async join(): Promise<RoomSnapshot> {
    const snapshot = await this.subscribeOnce();
    this.joined = true;
    this.stateCb?.('live');
    return snapshot;
  }

  async publish(type: string, payload: Record<string, unknown>): Promise<void> {
    const ack: unknown = await this.socket.emitWithAck(
      REALTIME_MESSAGES.PUBLISH,
      publishRequestSchema.parse({ type: type as PublishRequest['type'], payload }),
    );
    if (publishOkAckSchema.safeParse(ack).success) return;
    throw new ApiError(contractErrorPayloadSchema.parse(ack).code, 0);
  }

  close(): void {
    this.socket.disconnect();
  }

  private async subscribeOnce(): Promise<RoomSnapshot> {
    const ack: unknown = await this.socket.emitWithAck(
      REALTIME_MESSAGES.SUBSCRIBE,
      subscribeRequestSchema.parse({ roomId: this.roomId }),
    );
    const ok = subscribeOkAckSchema.safeParse(ack);
    if (ok.success) return ok.data.snapshot;
    throw new ApiError(contractErrorPayloadSchema.parse(ack).code, 0);
  }
}
