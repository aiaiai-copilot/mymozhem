import type { ApiClient } from '../api/api-client';
import { joinRoom } from '../api/endpoints';
import { decodeAccessClaims, type GuestSession } from './session';
import { isTerminalSessionFailure } from './session-failure';

// Автоперезаход при мёртвой сессии (находка №5): refresh-кука мертва → новый
// join по сохранённым code/displayName = НОВАЯ identity, очки не переносятся
// (тот же контракт, что авто-вход дизайна §5, — там тот же путь на загрузке
// страницы). Вызывающий показывает баннер «вы вошли заново».
export async function rejoinAsGuest(
  client: ApiClient,
  saved: GuestSession,
): Promise<{ accessToken: string; roomId: string }> {
  const res = await joinRoom(client, { code: saved.code, displayName: saved.displayName });
  const claims = decodeAccessClaims(res.accessToken);
  if (!claims.roomId) throw new Error('join token without roomId');
  return { accessToken: res.accessToken, roomId: claims.roomId };
}

// Классификация провала rejoin (находка Н13, дизайн §3(В), решение 4):
// терминален только серверный отказ по существу (ApiError 4xx — комната
// терминальна, join отклонён) → clearGuest + форма. Сеть/5xx/таймаут — пауза:
// личность не трогаем, повтор — по wake-слушателям ниже.
export const rejoinFailureAction = (e: unknown): 'terminal' | 'retry' =>
  isTerminalSessionFailure(e) ? 'terminal' : 'retry';

type ListenerTarget = {
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
};

// Повтор rejoin по пробуждению/online (находка Н13, дизайн §3(В) — «повтор при
// online/пробуждении», финревью батча B): только-online слушатель клинил
// «Входим…» навсегда при временном отказе без падения сети (рестарт сервера →
// 502, online не стреляет). Возвращаемый disposer снимает всех слушателей —
// сработка после unmount страницы сделала бы реальный joinRoom = сирота-
// identity + ротация refresh-куки. Парные события (focus+visibilitychange)
// дедупит гард in-flight у вызывающего.
export function createRejoinRetryListeners(
  retry: () => void,
  win: ListenerTarget,
  doc: ListenerTarget,
): () => void {
  win.addEventListener('online', retry);
  win.addEventListener('focus', retry);
  win.addEventListener('pageshow', retry);
  doc.addEventListener('visibilitychange', retry);
  return () => {
    win.removeEventListener('online', retry);
    win.removeEventListener('focus', retry);
    win.removeEventListener('pageshow', retry);
    doc.removeEventListener('visibilitychange', retry);
  };
}
