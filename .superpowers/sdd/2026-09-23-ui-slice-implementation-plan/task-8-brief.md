### Task 8: Realtime-клиент (`src/realtime/`)

**Files:**
- Create: `apps/web/src/realtime/socket-like.ts`, `apps/web/src/realtime/room-connection.ts`
- Test: `apps/web/src/realtime/room-connection.spec.ts` (+ `FakeSocket` в спеке)

**Interfaces:**
- Consumes: `ApiError` (Task 7), SDK realtime-схемы (`REALTIME_MESSAGES`, `subscribeOkAckSchema`, `publishOkAckSchema`, `projectedEventSchema`, `contractErrorPayloadSchema`).
- Produces: `SocketLike { onConnect(cb); onDisconnect(cb); onEvent(cb); emitWithAck(event, payload): Promise<unknown>; disconnect() }`; `createSocket(getAccessToken)` — единственный файл с `socket.io-client`; `RoomConnection(socket, roomId)`: `join(): Promise<RoomSnapshot>`, `onEvent(cb: (e: ProjectedEvent) => void)`, `onResync(cb: (s: RoomSnapshot) => void)`, `onStateChange(cb: (s: ConnectionState) => void)`, `publish(type: string, payload: Record<string, unknown>): Promise<void>`, `close()`; `ConnectionState = 'connecting' | 'live' | 'disconnected'`.

- [ ] **Step 1: Failing tests** (FakeSocket: программируемые ack, триггеры connect/disconnect/event):

```ts
it('join returns parsed snapshot on ok-ack')
it('join throws ApiError with server code on error-ack { code }')
it('onEvent parses ProjectedEvent; invalid payload → ZodError (fail-loud)')
it('reconnect after join → re-subscribe → onResync with fresh snapshot')
it('disconnect → onStateChange("disconnected"); connect → "live"')
it('publish ok-ack resolves; error-ack → ApiError')
```

- [ ] **Step 2: Run red**

- [ ] **Step 3: Implement**

```ts
// socket-like.ts — единственный импортёр socket.io-client (boundary web-socketio-only-in-realtime)
import { io, type Socket } from 'socket.io-client';
import { REALTIME_MESSAGES } from '@mymozhem/sdk';

export interface SocketLike { /* ...как в Interfaces... */ }

export const createSocket = (getAccessToken: () => string | null): SocketLike => {
  const socket: Socket = io({
    // same-origin (дизайн §0.3); токен читается на каждый handshake — reconnect со свежим.
    auth: (cb) => cb({ token: getAccessToken() }),
  });
  return {
    onConnect: (cb) => socket.on('connect', cb),
    onDisconnect: (cb) => socket.on('disconnect', cb),
    onEvent: (cb) => socket.on(REALTIME_MESSAGES.EVENT, cb),
    emitWithAck: (event, payload) => socket.emitWithAck(event, payload),
    disconnect: () => socket.disconnect(),
  };
};
```

```ts
// room-connection.ts
export class RoomConnection {
  private joined = false;
  private resyncCb: ((s: RoomSnapshot) => void) | null = null;
  private stateCb: ((s: ConnectionState) => void) | null = null;

  constructor(
    private readonly socket: SocketLike,
    private readonly roomId: string,
  ) {
    // Reconnect → re-subscribe → свежий snapshot в onResync (полный перефолд, дизайн §3).
    // Первый connect приходит до join() → joined=false → no-op.
    this.socket.onConnect(() => {
      this.stateCb?.(this.joined ? 'live' : 'connecting');
      if (this.joined) {
        void this.subscribeOnce().then((s) => this.resyncCb?.(s));
      }
    });
    this.socket.onDisconnect(() => this.stateCb?.('disconnected'));
  }

  onEvent(cb: (e: ProjectedEvent) => void): void {
    this.socket.onEvent((payload) => cb(projectedEventSchema.parse(payload)));
  }
  onResync(cb: (s: RoomSnapshot) => void): void { this.resyncCb = cb; }
  onStateChange(cb: (s: ConnectionState) => void): void { this.stateCb = cb; }

  async join(): Promise<RoomSnapshot> {
    const snapshot = await this.subscribeOnce();
    this.joined = true;
    this.stateCb?.('live');
    return snapshot;
  }

  async publish(type: string, payload: Record<string, unknown>): Promise<void> {
    const ack: unknown = await this.socket.emitWithAck(
      REALTIME_MESSAGES.PUBLISH,
      publishRequestSchema.parse({ type: type as PublishRequest['type'], payload }),
    );
    if (publishOkAckSchema.safeParse(ack).success) return;
    throw new ApiError(contractErrorPayloadSchema.parse(ack).code, 0);
  }

  close(): void { this.socket.disconnect(); }

  private async subscribeOnce(): Promise<RoomSnapshot> {
    const ack: unknown = await this.socket.emitWithAck(
      REALTIME_MESSAGES.SUBSCRIBE,
      subscribeRequestSchema.parse({ roomId: this.roomId }),
    );
    const ok = subscribeOkAckSchema.safeParse(ack);
    if (ok.success) return ok.data.snapshot;
    throw new ApiError(contractErrorPayloadSchema.parse(ack).code, 0);
  }
}
```

- [ ] **Step 4: Run green**, lint/typecheck

- [ ] **Step 5: Commit** — `feat(web): realtime-клиент RoomConnection (subscribe/resync/publish, ack-валидация)`

