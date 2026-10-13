import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveHostGateTarget, type GateSession } from './host-gate-flow';

// Пин дефекта репетиции первого события (2026-10-13): гейт безусловно делал
// refresh, игнорируя access-токен, который секундой раньше поставил login по
// setup-токену. На plain-HTTP LAN refresh-кука не живёт (Secure) → 401 →
// выброс на лендинг: консоль была недоступна сразу после успешного входа.
// Контракт: сначала токен в памяти, refresh — только когда память пуста.

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

// Подпись не проверяется по определению (декод display-only, session.ts) —
// достаточно валидной base64url-полезной нагрузки.
const makeToken = (claims: unknown): string =>
  `hdr.${btoa(JSON.stringify(claims))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}.sig`;

const REGISTERED = makeToken({ sub: 'org-1', kind: 'REGISTERED' });
const GUEST = makeToken({ sub: 'guest-1', kind: 'GUEST', roomId: 'room-1' });

// Фейк сессии по структурному интерфейсу GateSession: память + шпион refresh.
const makeSession = (initial: string | null) => {
  let token = initial;
  return {
    getAccessToken: () => token,
    refresh: vi.fn(async () => {
      token = REGISTERED;
    }),
  } satisfies GateSession;
};

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveHostGateTarget', () => {
  it('токен в памяти (свежий bootstrap) → маршрут БЕЗ refresh', async () => {
    const session = makeSession(REGISTERED);

    await expect(resolveHostGateTarget(session)).resolves.toBe('/host/new');
    expect(session.refresh).not.toHaveBeenCalled();
  });

  it('память пуста (перезагрузка /host) → refresh, затем маршрут', async () => {
    const session = makeSession(null);

    await expect(resolveHostGateTarget(session)).resolves.toBe('/host/new');
    expect(session.refresh).toHaveBeenCalledTimes(1);
  });

  it('refresh отклонён (сессии нет) → rejects: компонент ведёт на лендинг', async () => {
    const session = makeSession(null);
    session.refresh.mockRejectedValue(new Error('401'));

    await expect(resolveHostGateTarget(session)).rejects.toThrow('401');
  });

  it('refresh без токена в ответе → лендинг (не зависание в «Входим…»)', async () => {
    const session = makeSession(null);
    session.refresh.mockImplementation(() => Promise.resolve());

    await expect(resolveHostGateTarget(session)).resolves.toBe('/');
  });

  it('GUEST-токен в памяти → лендинг, refresh не зовётся', async () => {
    const session = makeSession(GUEST);

    await expect(resolveHostGateTarget(session)).resolves.toBe('/');
    expect(session.refresh).not.toHaveBeenCalled();
  });

  it('битый токен в памяти → лендинг (fail-closed, не throw наружу)', async () => {
    const session = makeSession('not-a-jwt');

    await expect(resolveHostGateTarget(session)).resolves.toBe('/');
  });

  it('REGISTERED + сохранённая комната → сразу /host/console', async () => {
    const { SessionStore } = await import('../../state/session');
    SessionStore.saveHostRoomId('room-1');
    const session = makeSession(REGISTERED);

    await expect(resolveHostGateTarget(session)).resolves.toBe('/host/console');
  });
});
