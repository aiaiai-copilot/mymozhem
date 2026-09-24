import type { TokenProvider } from '../api/token-provider';

// JWT-декод БЕЗ верификации — только для UI («кто я», моя комната). Все решения
// доступа — на сервере; подделанный payload прав не даёт (Review Focus 1).
export const decodeAccessClaims = (
  token: string,
): { sub: string; kind: 'GUEST' | 'REGISTERED'; roomId?: string } => {
  const part = token.split('.')[1];
  if (!part) throw new Error('malformed access token');
  return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as {
    sub: string;
    kind: 'GUEST' | 'REGISTERED';
    roomId?: string;
  };
};

const GUEST_KEY = 'mm.guest.session';
const HOST_ROOM_KEY = 'mm.host.roomId';
// Код комнаты хранится рядом с roomId: HTTP-контракт не отдаёт code по roomId
// (есть только createRoom-ответ), а консоль обязана показывать код и ссылки
// /play/<code>, /screen/<code> после перезагрузки.
const HOST_ROOM_CODE_KEY = 'mm.host.roomCode';

export interface GuestSession {
  code: string;
  displayName: string;
}

// Access-токен — в памяти (TTL ≤ 15 мин, refresh по 401); localStorage — только
// переживающая перезагрузку идентификация (код/имя гостя, roomId организатора).
export class SessionStore implements TokenProvider {
  private accessToken: string | null = null;

  constructor(private readonly refreshFn: () => Promise<string>) {}

  getAccessToken(): string | null {
    return this.accessToken;
  }

  // Не часть TokenProvider — страницы (Task 11+) ставят токен после login/guest-auth.
  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  async refresh(): Promise<void> {
    this.accessToken = await this.refreshFn();
  }

  static loadGuest(): GuestSession | null {
    try {
      const raw = localStorage.getItem(GUEST_KEY);
      return raw ? (JSON.parse(raw) as GuestSession) : null;
    } catch {
      // Битая запись (посторонний код, старая версия) — читается как «гостя нет»,
      // а не как падение загрузки страницы.
      return null;
    }
  }

  static saveGuest(s: GuestSession): void {
    localStorage.setItem(GUEST_KEY, JSON.stringify(s));
  }

  static clearGuest(): void {
    localStorage.removeItem(GUEST_KEY);
  }

  static loadHostRoomId(): string | null {
    return localStorage.getItem(HOST_ROOM_KEY);
  }

  static saveHostRoomId(id: string): void {
    localStorage.setItem(HOST_ROOM_KEY, id);
  }

  static loadHostRoomCode(): string | null {
    return localStorage.getItem(HOST_ROOM_CODE_KEY);
  }

  static saveHostRoomCode(code: string): void {
    localStorage.setItem(HOST_ROOM_CODE_KEY, code);
  }
}
