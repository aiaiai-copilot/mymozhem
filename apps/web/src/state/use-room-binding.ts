import { useEffect, useRef, useState } from 'react';
import type { ProjectedEvent } from '@mymozhem/sdk';
import { ApiError } from '../api/api-error';
import type { TokenProvider } from '../api/token-provider';
import { RoomConnection, type ConnectionState } from '../realtime/room-connection';
import { createSocket } from '../realtime/socket-like';
import { createFocusRefetcher } from './focus-refetch';
import { LogStore } from './log-store';

// Код отказа стартового join (находка №3): ApiError несёт wire-код; сетевые
// отказы (не ApiError) — null, их место — баннер 'disconnected', не экраны ошибок.
export const joinErrorCode = (e: unknown): string | null =>
  e instanceof ApiError ? e.code : null;

// Тонкий React-клей поверх RoomConnection + LogStore (дизайн §3): вся фолд-логика
// (буфер до snapshot, перефолд на resync) уже оттестирована в LogStore и
// RoomConnection; хук только поднимает их колбэки в useState. Новый roomId →
// новый effect → новая пара store/conn, старая закрывается cleanup'ом.
export function useRoomBinding(
  roomId: string | null,
  tokens: TokenProvider,
  // opts НЕ входит в deps effect: объект-литерал перезапускал бы effect на
  // каждый рендер; колбэк читается из замыкания effect — потребители передают
  // стабильные useCallback.
  opts?: { onSessionDead?: () => void },
): {
  connectionState: ConnectionState;
  events: ProjectedEvent[];
  appSettings: Record<string, unknown>;
  joinError: string | null;
  publish: (type: string, payload: Record<string, unknown>) => Promise<void>;
} {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [events, setEvents] = useState<ProjectedEvent[]>([]);
  const [appSettings, setAppSettings] = useState<Record<string, unknown>>({});
  const [joinError, setJoinError] = useState<string | null>(null);
  const connRef = useRef<RoomConnection | null>(null);

  useEffect(() => {
    if (!roomId) return;
    setJoinError(null);
    const store = new LogStore();
    // Refresh-хук: протухший access-токен — единственная самовосстанавливающаяся
    // причина handshake-отказов (refresh-кука живёт дольше); RoomConnection сам
    // дозирует — один вызов на стрик обрыва.
    const conn = new RoomConnection(
      createSocket(() => tokens.getAccessToken()),
      roomId,
      () => tokens.refresh(),
      opts?.onSessionDead,
    );
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
    // Кик reconnect'а при пробуждении вкладки (находка №8): WebKit выбрасывает
    // backoff-таймер socket.io из замороженной вкладки — вечный баннер до reload.
    // pageshow — возврат из bfcache (ключевой сигнал iOS Safari),
    // visibilitychange/focus — парный сигнал десктопа; дедуп парных событий —
    // тот же createFocusRefetcher, что у ростера (находка №6). Протухший токен
    // при пробуждении обслуживает существующий путь connect_error → refresh.
    const onWake = createFocusRefetcher(() => {
      if (document.visibilityState === 'visible') conn.wakeUp();
    });
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('pageshow', onWake);
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
      .catch((e: unknown) => {
        setJoinError(joinErrorCode(e));
        setConnectionState('disconnected');
      });
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('pageshow', onWake);
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
    joinError,
    publish: (type, payload) => {
      const conn = connRef.current;
      // roomId === null → effect не поднимал соединение; publish без комнаты —
      // явный отказ, а не молчаливый emit в никуда.
      if (!conn) return Promise.reject(new ApiError('NOT_CONNECTED', 0));
      return conn.publish(type, payload);
    },
  };
}
