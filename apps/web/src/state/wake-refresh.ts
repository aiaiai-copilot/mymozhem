import { useEffect } from 'react';
import { createFocusRefetcher } from './focus-refetch';
import { decodeAccessClaims, type SessionStore } from './session';

// Порог проактивного refresh — звонок строителя, дизайн §4: ~2 мин при TTL
// access-токена 15 мин. По пробуждению вкладки токен с остатком меньше порога
// обновляется ДО того, как запросы пойдут с протухшим (находка Н13: warn-шум
// «jwt expired» в логах простоя — каждый первый запрос после простоя шёл по
// реактивному пути 401 → refresh → retry).
export const REFRESH_AHEAD_MS = 120_000;

// «Токен скоро протухнет?» null → false (Review Focus 2: страница без
// access-токена — screen до join, host-login — иначе стреляла бы refresh без
// куки на каждый focus → новый warn-шум «no refresh cookie» вместо старого).
// malformed → false: decodeAccessClaims бросает (fail-loud), здесь ловим.
export function accessTokenDueSoon(
  token: string | null,
  nowMs: number,
  thresholdMs: number = REFRESH_AHEAD_MS,
): boolean {
  if (token === null) return false;
  try {
    return decodeAccessClaims(token).exp * 1000 - nowMs < thresholdMs;
  } catch {
    return false;
  }
}

// Проактивный refresh по пробуждению (дизайн §3(Г)). Дедуп парных
// visibilitychange/focus — тот же createFocusRefetcher, что у ростера
// (находка №6). due → refresh, и только ПОСЛЕ его settle — onWake
// (refresh-then-kick: handshake уйдёт со свежим токеном); не due → onWake
// сразу. Провал refresh глушится: реактивный 401-путь ApiClient остаётся
// страховкой, а onWake (кик reconnect) обязан стрельнуть в любом случае.
export function createSessionWakeRefresher(
  getToken: () => string | null,
  refresh: () => Promise<void>,
  opts?: {
    thresholdMs?: number;
    minIntervalMs?: number;
    now?: () => number;
    onWake?: () => void;
  },
): () => void {
  const now = opts?.now ?? Date.now;
  return createFocusRefetcher(
    () => {
      if (accessTokenDueSoon(getToken(), now(), opts?.thresholdMs)) {
        void refresh()
          .catch(() => {})
          .finally(() => opts?.onWake?.());
      } else {
        opts?.onWake?.();
      }
    },
    opts?.minIntervalMs,
    opts?.now,
  );
}

// Хук для страниц, владеющих сессией вне room-привязки (host gate/login/setup —
// builder-check Q3 дизайна §3(Г)): те же сигналы пробуждения, что у
// useRoomBinding, плюс online (ретрай обрыва, дизайн §3(В)). Room-страницы
// (console/play/screen) покрыты use-room-binding автоматически.
export function useSessionWakeRefresh(session: SessionStore): void {
  useEffect(() => {
    const onWake = createSessionWakeRefresher(
      () => session.getAccessToken(),
      () => session.refresh(),
    );
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('pageshow', onWake);
    window.addEventListener('online', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('pageshow', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [session]);
}
