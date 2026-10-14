import { decodeAccessClaims, SessionStore } from '../../state/session';
import { HOST_CONSOLE_PATH, HOST_NEW_PATH } from '../../routes';

// Структурный минимум сессии для гейта (реализация — hostSession, SessionStore).
export interface GateSession {
  getAccessToken(): string | null;
  refresh(): Promise<void>;
}

// Тип — от констант routes.ts (находка A): navigate гейта не может разъехаться
// с роутером. '/' остаётся литералом — корень зарегистрирован всегда.
export type HostGateTarget = typeof HOST_CONSOLE_PATH | typeof HOST_NEW_PATH | '/';

// Маршрут гейта /host. СНАЧАЛА токен в памяти: его только что поставил login по
// setup-токену (ADR-012 §2), а refresh-кука на plain-HTTP LAN не живёт (Secure)
// — безусловный refresh делал консоль недоступной сразу после успешного входа
// (дефект репетиции 2026-10-13). Refresh — только когда память пуста (прямой
// заход/перезагрузка /host). Бросок refresh (сессии нет) уходит наверх —
// компонент ведёт на лендинг; битый/гостевой токен — лендинг fail-closed.
// Одна комната на организатора (MVP): была — сразу в консоль.
export async function resolveHostGateTarget(session: GateSession): Promise<HostGateTarget> {
  let token = session.getAccessToken();
  if (!token) {
    await session.refresh();
    token = session.getAccessToken();
  }
  if (!token) return '/';
  // Декод display-only, без верификации (session.ts): доступ всё равно решит
  // сервер; здесь лишь маршрутизация — гостю в /host делать нечего.
  try {
    if (decodeAccessClaims(token).kind !== 'REGISTERED') return '/';
  } catch {
    return '/';
  }
  return SessionStore.loadHostRoomId() ? HOST_CONSOLE_PATH : HOST_NEW_PATH;
}
