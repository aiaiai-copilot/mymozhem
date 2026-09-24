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
    // именно сюда, а не в disconnect: socket.io молча ретраит, 'connect' не наступает.
    onConnectError: (cb) => socket.on('connect_error', cb),
    onDisconnect: (cb) => socket.on('disconnect', cb),
    onEvent: (cb) => socket.on(REALTIME_MESSAGES.EVENT, cb),
    emitWithAck: (event, payload) => socket.emitWithAck(event, payload),
    disconnect: () => socket.disconnect(),
  };
};
