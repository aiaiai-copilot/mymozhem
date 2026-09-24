import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionStore, decodeAccessClaims, type GuestSession } from './session';

// Сессионный слой (дизайн §3): access-токен живёт только в памяти (TTL ≤ 15 мин,
// silent refresh), localStorage — лишь переживающая перезагрузку идентификация.
// Тест-раннер — node (vite.config.ts), localStorage в нём нет: подставляем
// in-memory стаб через stubGlobal. atob/btoa — глобалы Node ≥16, стаб не нужен
// (Buffer не используем: типы node в tsconfig браузерного пакета не подключены).

// In-memory стаб Web Storage: реализация читает глобал localStorage напрямую,
// поэтому достаточно минимального контракта get/set/remove.
class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

// Фейковый JWT: подпись не проверяется по определению (декод display-only),
// поэтому достаточно валидной base64url-полезной нагрузки.
const makeToken = (claims: unknown): string =>
  `hdr.${btoa(JSON.stringify(claims))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}.sig`;

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decodeAccessClaims', () => {
  it('decodes claims payload (base64url) — sub/kind/roomId', () => {
    const claims = { sub: 'actor-1', kind: 'GUEST', roomId: 'room-1' };

    expect(decodeAccessClaims(makeToken(claims))).toEqual(claims);
    // Без roomId (организатор вне комнаты) поле просто отсутствует.
    expect(decodeAccessClaims(makeToken({ sub: 'actor-2', kind: 'REGISTERED' }))).toEqual({
      sub: 'actor-2',
      kind: 'REGISTERED',
    });
  });

  it('throws on malformed token', () => {
    // Нет сегмента payload — осмысленная ошибка, а не TypeError глубже.
    expect(() => decodeAccessClaims('not-a-jwt')).toThrow('malformed access token');
    // Payload есть, но не JSON — JSON.parse пробрасывает; fail-loud, не тихий null.
    expect(() => decodeAccessClaims('hdr.%%%bad%%%.sig')).toThrow();
  });
});

describe('SessionStore', () => {
  it('guest session localStorage roundtrip; clearGuest removes', () => {
    const guest: GuestSession = { code: 'ABCD-2345', displayName: 'Гость 7' };

    expect(SessionStore.loadGuest()).toBeNull();
    SessionStore.saveGuest(guest);
    expect(SessionStore.loadGuest()).toEqual(guest);

    SessionStore.clearGuest();
    expect(SessionStore.loadGuest()).toBeNull();
  });

  it('loadGuest: битый JSON в localStorage → null, не исключение', () => {
    // Перезапись ключа посторонним кодом/старой версией не должна ронять загрузку
    // страницы: битая запись читается как «гостя нет».
    localStorage.setItem('mm.guest.session', '{corrupted');
    expect(SessionStore.loadGuest()).toBeNull();
  });

  it('host roomId localStorage roundtrip', () => {
    expect(SessionStore.loadHostRoomId()).toBeNull();
    SessionStore.saveHostRoomId('room-9');
    expect(SessionStore.loadHostRoomId()).toBe('room-9');
  });

  it('refresh() replaces accessToken (через инжектированный refreshFn)', async () => {
    const store = new SessionStore(() => Promise.resolve('new-token'));

    expect(store.getAccessToken()).toBeNull();
    store.setAccessToken('old-token');
    expect(store.getAccessToken()).toBe('old-token');

    await store.refresh();
    // После refresh getAccessToken обязан отдавать уже новый токен — иначе retry
    // по 401 в api-client ушёл бы со старым (контракт TokenProvider).
    expect(store.getAccessToken()).toBe('new-token');
  });
});
