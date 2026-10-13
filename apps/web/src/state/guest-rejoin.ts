import type { ApiClient } from '../api/api-client';
import { joinRoom } from '../api/endpoints';
import { decodeAccessClaims, type GuestSession } from './session';

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
