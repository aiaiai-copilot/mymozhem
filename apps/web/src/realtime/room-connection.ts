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
    // Триггер «сессия мертва» (находка №5): стреляет ТОЛЬКО из провала refresh
    // (мёртвая refresh-кука, self-heal невозможен). Обычный disconnect сюда НЕ
    // ведёт — сетевой обрыв лечит сам socket.io. Потребитель — автоперезаход.
    private readonly onSessionDead?: () => void,
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
      // протухший за время сна/простоя access-токен (gateway на любой
      // auth-отказ отвечает одинаковым SESSION_INVALID, причины на клиенте не
      // различить надёжно, поэтому не фильтруем по err). CONNECT_ERROR
      // ТЕРМИНАЛЕН для socket.io-client (4.8.3): Socket.destroy() →
      // Manager._destroy → _close(skipReconnect=true) — библиотека НЕ
      // планирует retry никогда, ни в одном браузере (находка №8: «refresh
      // 200 → тишина» — это by-design teardown, а не заморозка таймера;
      // перезапуск — только ручной connect(), официальный паттерн socket.io).
      // Поэтому: refresh — ровно один на стрик обрыва (иначе retry-шторм
      // превратился бы в refresh-шторм), успех → немедленный kickReconnect
      // со свежим токеном. Провал refresh (мёртвая refresh-кука) — кик
      // бессмысленен: явный 'disconnected' + onSessionDead (автоперезаход
      // страницы, находка №5). Обычный onDisconnect сюда НЕ ведёт: сетевой
      // обрыв лечит сам socket.io (там skipReconnect=false, backoff жив).
      if (!this.joined || this.refreshAttempted || !this.refreshAccessToken) return;
      this.refreshAttempted = true;
      void this.refreshAccessToken()
        .then(() => this.socket.kickReconnect())
        .catch(() => {
          this.stateCb?.('disconnected');
          this.onSessionDead?.();
        });
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

  // Кик reconnect'а при пробуждении вкладки (находка №8): WebKit теряет
  // backoff-таймер socket.io в замороженной вкладке — вечный баннер
  // «Переподключаемся…» до reload. Вызов — из DOM-слушателей useRoomBinding
  // (visibilitychange/focus/pageshow). Гард joined: начальным подключением
  // управляет сам socket.io, кик нужен только против застрявшего backoff
  // после установленной привязки. На живом соединении — no-op.
  wakeUp(): void {
    if (this.joined && !this.socket.isConnected()) this.socket.kickReconnect();
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
