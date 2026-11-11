import { useEffect, useRef, useState } from 'react';
import type { ProjectedEvent } from '@mymozhem/sdk';
import { ApiError } from '../api/api-error';
import type { TokenProvider } from '../api/token-provider';
import { RoomConnection, type ConnectionState } from '../realtime/room-connection';
import { createSocket } from '../realtime/socket-like';
import { LogStore } from './log-store';
import { createSessionWakeRefresher } from './wake-refresh';

// Код отказа стартового join (находка №3): ApiError несёт wire-код; сетевые
// отказы (не ApiError) — null, их место — баннер 'disconnected', не экраны ошибок.
export const joinErrorCode = (e: unknown): string | null =>
  e instanceof ApiError ? e.code : null;

// Поверхность отказа стартовой подписки (carry финревью батча A): после T1
// join может отказать ApiError('SUBSCRIBE_TIMEOUT') — подписка сама не
// восстанавливается (join не идемпотентен, re-subscribe под гардом joined в
// RoomConnection), поэтому честный текст с явным советом, а не только общий
// баннер «переподключаемся», который в этом состоянии врёт. Общая для
// play/console/screen — живёт рядом с joinErrorCode (владелец контракта кодов).
export const joinErrorText = (code: string | null): string | null =>
  code === 'SUBSCRIBE_TIMEOUT'
    ? 'Комната не подтвердила подключение — проверьте связь и обновите страницу.'
    : null;

// Баннер «переподключаемся» честен, только пока reconnect действительно идёт
// (финревью батча C, Important 1): после упавшего СТАРТОВОГО join никто не
// переподключается — при живой joinErrorSurface баннер скрывается, говорит
// alert joinErrorText. Иначе на экране одновременно «ничего не нажимай» и
// «обновите страницу».
export const reconnectBannerVisible = (
  state: ConnectionState,
  joinErrorSurface: string | null,
): boolean => state === 'disconnected' && joinErrorSurface === null;

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
    // Пробуждение вкладки (находки №8 и Н13): проактивный refresh, если до exp
    // access-токена меньше порога, и только ПОСЛЕ него — кик reconnect
    // (refresh-then-kick, дизайн §3(Г): handshake уйдёт со свежим токеном;
    // реактивный путь connect_error → refresh остаётся страховкой). Кик нужен
    // против застрявшего backoff WebKit — только при видимой вкладке.
    // pageshow — возврат из bfcache (ключевой сигнал iOS Safari), online —
    // ретрай сетевого обрыва (дизайн §3(В)); дедуп парных событий — внутри
    // createSessionWakeRefresher (тот же createFocusRefetcher, находка №6).
    const onWake = createSessionWakeRefresher(
      () => tokens.getAccessToken(),
      () => tokens.refresh(),
      {
        onWake: () => {
          if (document.visibilityState === 'visible') conn.wakeUp();
        },
      },
    );
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('pageshow', onWake);
    window.addEventListener('online', onWake);
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
      window.removeEventListener('online', onWake);
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
