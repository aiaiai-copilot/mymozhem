### Task 10: SessionStore + useRoomBinding

**Files:**
- Create: `apps/web/src/state/session.ts`, `apps/web/src/state/use-room-binding.ts`
- Test: `apps/web/src/state/session.spec.ts`

**Interfaces:**
- Consumes: `TokenProvider`, endpoints `refreshSession` (Task 7), `RoomConnection`+`createSocket` (Task 8), `LogStore` (Task 9).
- Produces: `decodeAccessClaims(token): { sub: string; kind: 'GUEST'|'REGISTERED'; roomId?: string }`; `SessionStore implements TokenProvider` (+ static `loadGuest/saveGuest/clearGuest` `{code, displayName}`, `loadHostRoomId/saveHostRoomId`); `useRoomBinding(roomId: string | null, tokens: TokenProvider): { connectionState: ConnectionState; events: ProjectedEvent[]; appSettings: Record<string, unknown>; publish(type, payload): Promise<void> }`.

- [ ] **Step 1: Failing tests session** (вкл. Review Focus 1 — декод display-only, комментарий в коде):

```ts
it('decodes claims payload (base64url) — sub/kind/roomId')
it('throws on malformed token')
it('guest session localStorage roundtrip; clearGuest removes')
it('refresh() replaces accessToken (через инжектированный refreshFn)')
```

- [ ] **Step 2: Implement session.ts**

```ts
import type { TokenProvider } from '../api/token-provider';

// JWT-декод БЕЗ верификации — только для UI («кто я», моя комната). Все решения
// доступа — на сервере; подделанный payload прав не даёт (Review Focus 1).
export const decodeAccessClaims = (token: string): { sub: string; kind: 'GUEST' | 'REGISTERED'; roomId?: string } => {
  const part = token.split('.')[1];
  if (!part) throw new Error('malformed access token');
  return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { sub: string; kind: 'GUEST' | 'REGISTERED'; roomId?: string };
};

const GUEST_KEY = 'mm.guest.session';
const HOST_ROOM_KEY = 'mm.host.roomId';

export interface GuestSession { code: string; displayName: string; }

// Access-токен — в памяти (TTL ≤ 15 мин, refresh по 401); localStorage — только
// переживающая перезагрузку идентификация (код/имя гостя, roomId организатора).
export class SessionStore implements TokenProvider {
  private accessToken: string | null = null;
  constructor(private readonly refreshFn: () => Promise<string>) {}
  getAccessToken(): string | null { return this.accessToken; }
  setAccessToken(token: string): void { this.accessToken = token; }
  async refresh(): Promise<void> { this.accessToken = await this.refreshFn(); }

  static loadGuest(): GuestSession | null {
    try {
      const raw = localStorage.getItem(GUEST_KEY);
      return raw ? (JSON.parse(raw) as GuestSession) : null;
    } catch { return null; }
  }
  static saveGuest(s: GuestSession): void { localStorage.setItem(GUEST_KEY, JSON.stringify(s)); }
  static clearGuest(): void { localStorage.removeItem(GUEST_KEY); }
  static loadHostRoomId(): string | null { return localStorage.getItem(HOST_ROOM_KEY); }
  static saveHostRoomId(id: string): void { localStorage.setItem(HOST_ROOM_KEY, id); }
}
```

- [ ] **Step 3: Implement use-room-binding.ts** (тонкий React-клей; логика — в LogStore, тестирована):

```ts
export function useRoomBinding(roomId: string | null, tokens: TokenProvider): {
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
    conn.onEvent((e) => { store.pushLive(e); setEvents(store.all()); });
    conn.onResync((snapshot) => {
      store.reset();
      store.applySnapshot(snapshot.events);
      setAppSettings(snapshot.appSettings);
      setEvents(store.all());
    });
    conn.onStateChange(setConnectionState);
    void conn.join().then((snapshot) => {
      store.applySnapshot(snapshot.events);
      setAppSettings(snapshot.appSettings);
      setEvents(store.all());
    });
    return () => conn.close();
  }, [roomId, tokens]);

  return {
    connectionState,
    events,
    appSettings,
    publish: (type, payload) => {
      const conn = connRef.current;
      if (!conn) return Promise.reject(new ApiError('NOT_CONNECTED', 0));
      return conn.publish(type, payload);
    },
  };
}
```

- [ ] **Step 4: Run green** (unit session), typecheck

- [ ] **Step 5: Commit** — `feat(web): SessionStore + useRoomBinding (snapshot/resync фолд в React)`

