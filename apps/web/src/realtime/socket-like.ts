import { io, type Socket } from 'socket.io-client';
import { REALTIME_MESSAGES } from '@mymozhem/sdk';

// Единственный импортёр socket.io-client в apps/web (boundary web-socketio-only-in-realtime,
// зеркало REQ-RT-006 на клиенте). Наружу — минимальный SocketLike: RoomConnection и
// спеки работают с интерфейсом, а не с Socket из библиотеки.
export interface SocketLike {
  onConnect(cb: () => void): void;
  onConnectError(cb: (err: Error) => void): void;
  onDisconnect(cb: () => void): void;
  onEvent(cb: (payload: unknown) => void): void;
  emitWithAck(event: string, payload: unknown): Promise<unknown>;
  disconnect(): void;
  isConnected(): boolean;
  // Принудительный немедленный reconnect в обход backoff-таймера (находка №8).
  kickReconnect(): void;
}

export const createSocket = (getAccessToken: () => string | null): SocketLike => {
  const socket: Socket = io({
    // same-origin (дизайн §0.3): URL не нужен, dev-прокси/прод отдают /socket.io сами.
    // Токен читается на каждый handshake — reconnect уходит уже со свежим access-токеном.
    auth: (cb) => cb({ token: getAccessToken() }),
  });
  return {
    onConnect: (cb) => socket.on('connect', cb),
    // Отказ handshake (gateway auth-middleware отвечает SESSION_INVALID) приходит
    // именно сюда, а не в disconnect; для auth-отказа он терминален — retry
    // не планируется никогда (teardown, см. комментарий kickReconnect ниже):
    // восстановление — только refresh + кик в RoomConnection.
    onConnectError: (cb) => socket.on('connect_error', cb),
    onDisconnect: (cb) => socket.on('disconnect', cb),
    onEvent: (cb) => socket.on(REALTIME_MESSAGES.EVENT, cb),
    emitWithAck: (event, payload) => socket.emitWithAck(event, payload),
    disconnect: () => socket.disconnect(),
    isConnected: () => socket.connected,
    // Принудительный немедленный reconnect в обход backoff (находка №8).
    // Два застрявших состояния Manager'а socket.io-client 4.8.3:
    // 1) auth-отказ handshake (CONNECT_ERROR) — терминальный teardown:
    //    Socket.destroy() → Manager._destroy → _close(skipReconnect=true);
    //    retry не планируется НИКОГДА, ни в одном браузере — перезапуск
    //    только ручной (официальный паттерн: connect() из connect_error);
    // 2) транспортный обрыв в замороженной вкладке WebKit — backoff-таймер
    //    выброшен браузером, _reconnecting=true навсегда (все retry-пути
    //    заперты этим флагом; Socket.connect() при _reconnecting=true —
    //    no-op, socket.js).
    // _close() сбрасывает оба состояния (skipReconnect/_reconnecting, чистит
    // таймеры, backoff.reset() — идемпотентно для состояния 1), connect()
    // стартует немедленную попытку в обход backoff и переподписывает Socket
    // на Manager (subEvents — destroy() в состоянии 1 их снял). Токен
    // перечитывается auth-колбэком. _close публичен по d.ts, подчёркнут по
    // конвенции — tripwire при апгрейде socket.io-client.
    kickReconnect: () => {
      socket.io._close();
      socket.connect();
    },
  };
};
