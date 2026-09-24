import { useEffect, useRef, useState } from 'react';
import type { ProjectedEvent } from '@mymozhem/sdk';
import { ApiError } from '../api/api-error';
import type { TokenProvider } from '../api/token-provider';
import { RoomConnection, type ConnectionState } from '../realtime/room-connection';
import { createSocket } from '../realtime/socket-like';
import { LogStore } from './log-store';

// Тонкий React-клей поверх RoomConnection + LogStore (дизайн §3): вся фолд-логика
// (буфер до snapshot, перефолд на resync) уже оттестирована в LogStore и
// RoomConnection; хук только поднимает их колбэки в useState. Новый roomId →
// новый effect → новая пара store/conn, старая закрывается cleanup'ом.
export function useRoomBinding(
  roomId: string | null,
  tokens: TokenProvider,
): {
  connectionState: ConnectionState;
  events: ProjectedEvent[];
  appSettings: Record<string, unknown>;
  publish: (type: string, payload: Record<string, unknown>) => Promise<void>;
} {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [events, setEvents] = useState<ProjectedEvent[]>([]);
  const [appSettings, setAppSettings] = useState<Record<string, unknown>>({});
  const connRef = useRef<RoomConnection | null>(null);

  useEffect(() => {
    if (!roomId) return;
    const store = new LogStore();
    const conn = new RoomConnection(createSocket(() => tokens.getAccessToken()), roomId);
    connRef.current = conn;
    conn.onEvent((e) => {
      store.pushLive(e);
      setEvents(store.all());
    });
    conn.onResync((snapshot) => {
      // Re-subscribe → полный перефолд: старый лог с возможными дупами окна
      // handshake выбрасывается, фолд строится заново от свежего snapshot'а.
      store.reset();
      store.applySnapshot(snapshot.events);
      setAppSettings(snapshot.appSettings);
      setEvents(store.all());
    });
    conn.onStateChange(setConnectionState);
    // join() НЕ идемпотентен (второй вызов = второй subscribe) — ровно один вызов
    // на effect. Стартовый отказ обязан обрабатываться: gateway при ошибке subscribe
    // зачищает серверную подписку (registry.remove + socket.leave + ack-ошибка,
    // realtime.gateway.ts:176-186), но соединение НЕ разрывает — без catch UI
    // навсегда завис бы в 'connecting' с unhandled rejection. Переводим в явный
    // 'disconnected' через setConnectionState (onStateChange уже подписан выше);
    // retry — забота потребителя по этому состоянию.
    void conn
      .join()
      .then((snapshot) => {
        store.applySnapshot(snapshot.events);
        setAppSettings(snapshot.appSettings);
        setEvents(store.all());
      })
      .catch(() => setConnectionState('disconnected'));
    return () => {
      // Обнуляем ref ДО следующего effect (cleanup всегда предшествует ему):
      // publish на уже закрытом соединении обязан отказать NOT_CONNECTED,
      // а не уйти emit'ом в мёртвый сокет.
      connRef.current = null;
      conn.close();
    };
  }, [roomId, tokens]);

  return {
    connectionState,
    events,
    appSettings,
    publish: (type, payload) => {
      const conn = connRef.current;
      // roomId === null → effect не поднимал соединение; publish без комнаты —
      // явный отказ, а не молчаливый emit в никуда.
      if (!conn) return Promise.reject(new ApiError('NOT_CONNECTED', 0));
      return conn.publish(type, payload);
    },
  };
}
