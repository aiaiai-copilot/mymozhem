### Task 4: `onSessionDead` в RoomConnection + `joinError` в useRoomBinding (подложка №5 и №3)

**Закрывает:** дизайн §5 (триггер автоперезахода) и §7 (проброс кода отказа join); REQ-ID-016-контур.

**Files:**
- Test: `apps/web/src/realtime/room-connection.spec.ts` (добавить кейсы)
- Modify: `apps/web/src/realtime/room-connection.ts` (4-й параметр конструктора, вызов в catch)
- Modify: `apps/web/src/state/use-room-binding.ts` (opts + `joinError` + экспорт `joinErrorCode`)
- Test: `apps/web/src/state/use-room-binding.spec.ts` (создать — чистый `joinErrorCode`)

**Interfaces:**
- Consumes: `RoomConnection(socket, roomId, refreshAccessToken?)`, `useRoomBinding(roomId, tokens)`.
- Produces:
  - `new RoomConnection(socket, roomId, refreshAccessToken?, onSessionDead?: () => void)` — onSessionDead стреляет ТОЛЬКО из провала refresh-хука. Потребитель — Task 5.
  - `useRoomBinding(roomId, tokens, opts?: { onSessionDead?: () => void })` возвращает `+ joinError: string | null` (wire-код ApiError стартового join; null при успехе и при не-ApiError). Потребитель — Task 6.
  - `joinErrorCode(e: unknown): string | null` (экспорт из use-room-binding.ts).

- [ ] **Step 1: Падающие тесты RoomConnection**

В `room-connection.spec.ts` добавить (FakeSocket и flushMicrotasks уже есть в файле):

```ts
  it('провал refresh-хука → onSessionDead + состояние disconnected (находка №5)', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    let sessionDead = 0;
    const states: ConnectionState[] = [];
    const conn = new RoomConnection(
      socket,
      ROOM_ID,
      () => Promise.reject(new Error('refresh cookie dead')),
      () => {
        sessionDead += 1;
      },
    );
    conn.onStateChange((s) => states.push(s));

    socket.triggerConnect();
    await conn.join();
    socket.triggerDisconnect();
    socket.triggerConnectError();

    await flushMicrotasks();

    expect(sessionDead).toBe(1);
    expect(states[states.length - 1]).toBe('disconnected');
  });

  it('обычный disconnect (сеть) → onSessionDead НЕ стреляет (Review Focus 5)', async () => {
    const socket = new FakeSocket();
    socket.programAck(REALTIME_MESSAGES.SUBSCRIBE, { ok: true, snapshot: SNAPSHOT });
    let sessionDead = 0;
    const conn = new RoomConnection(socket, ROOM_ID, undefined, () => {
      sessionDead += 1;
    });

    socket.triggerConnect();
    await conn.join();
    socket.triggerDisconnect();
    await flushMicrotasks();

    expect(sessionDead).toBe(0);
  });
```

(Форма ok-ack — `{ ok: true, snapshot }`, как в существующих кейсах файла, стр. 82.)

- [ ] **Step 2: Прогнать — должно падать**

Run: `pnpm --filter @mymozhem/web exec vitest run src/realtime/room-connection.spec.ts`
Expected: FAIL (4-й параметр игнорируется → sessionDead === 0).

- [ ] **Step 3: Реализация RoomConnection**

`room-connection.ts`: конструктор += `private readonly onSessionDead?: () => void` (4-м, опциональным — существующие 3-аргументные вызовы не тронуты). В onConnectError заменить catch:

```ts
      if (!this.joined || this.refreshAttempted || !this.refreshAccessToken) return;
      this.refreshAttempted = true;
      // Провал refresh = мёртвая refresh-кука: self-heal невозможен, это единственная
      // ветка «сессия мертва» (находка №5). Состояние — disconnected (баннер честен
      // на время перезахода), onSessionDead — триггер автоперезахода страницы.
      // Обычный onDisconnect сюда НЕ ведёт: сетевой обрыв лечит сам socket.io.
      void this.refreshAccessToken()
        .catch(() => {
          this.stateCb?.('disconnected');
          this.onSessionDead?.();
        });
```

- [ ] **Step 4: Падающий тест `joinErrorCode`**

Создать `apps/web/src/state/use-room-binding.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/api-error';
import { joinErrorCode } from './use-room-binding';

// Код отказа стартового join (находка №3): консоль различает «комната из прошлой
// БД» (ACTOR_NOT_MEMBER → экран «не найдена») и сетевой обрыв (баннер). Хук
// без DOM-тестов (нет @testing-library/react — известный deferred T10), поэтому
// маппинг — чистая функция.
describe('joinErrorCode', () => {
  it('ApiError → wire-код', () => {
    expect(joinErrorCode(new ApiError('ACTOR_NOT_MEMBER', 0))).toBe('ACTOR_NOT_MEMBER');
    expect(joinErrorCode(new ApiError('NOT_FOUND', 404))).toBe('NOT_FOUND');
  });

  it('не-ApiError (сеть, ZodError) → null', () => {
    expect(joinErrorCode(new TypeError('fetch failed'))).toBeNull();
    expect(joinErrorCode(new Error('boom'))).toBeNull();
    expect(joinErrorCode('строка')).toBeNull();
  });
});
```

Run: `pnpm --filter @mymozhem/web exec vitest run src/state/use-room-binding.spec.ts`
Expected: FAIL (`joinErrorCode` не экспортирован).

- [ ] **Step 5: Реализация useRoomBinding**

`use-room-binding.ts`:

```ts
// Код отказа стартового join (находка №3): ApiError несёт wire-код; сетевые
// отказы (не ApiError) — null, их место — баннер 'disconnected', не экраны ошибок.
export const joinErrorCode = (e: unknown): string | null =>
  e instanceof ApiError ? e.code : null;
```

Сигнатура хука:

```ts
export function useRoomBinding(
  roomId: string | null,
  tokens: TokenProvider,
  opts?: { onSessionDead?: () => void },
): {
  connectionState: ConnectionState;
  events: ProjectedEvent[];
  appSettings: Record<string, unknown>;
  joinError: string | null;
  publish: (type: string, payload: Record<string, unknown>) => Promise<void>;
} {
```

В теле: `const [joinError, setJoinError] = useState<string | null>(null);`; в начало effect — `setJoinError(null);`; конструктору RoomConnection передать 4-м `opts?.onSessionDead`; в `join().catch`:

```ts
      .catch((e: unknown) => {
        setJoinError(joinErrorCode(e));
        setConnectionState('disconnected');
      });
```

В return добавить `joinError`. Депсы effect: `[roomId, tokens]` — `opts` НЕ добавлять (объект-литерал в deps перезапускал бы effect на каждый рендер; колбэк читается из замыкания effect — потребители передают стабильные useCallback). Комментарий об этом — у параметра opts.

- [ ] **Step 6: Прогнать — зелёное**

Run: `pnpm --filter @mymozhem/web exec vitest run src/realtime/room-connection.spec.ts src/state/use-room-binding.spec.ts`
Expected: PASS.

- [ ] **Step 7: Гейты + коммит**

Run: `pnpm --filter @mymozhem/web lint && pnpm --filter @mymozhem/web typecheck && pnpm --filter @mymozhem/web test`
Expected: зелёные; typecheck подтверждает, что существующие потребители useRoomBinding (play/screen/console) компилируются с новым полем в возврате (поле добавочное — ломать не должно).

```bash
git add apps/web/src/realtime/room-connection.ts apps/web/src/realtime/room-connection.spec.ts apps/web/src/state/use-room-binding.ts apps/web/src/state/use-room-binding.spec.ts
git commit -m "feat(web): onSessionDead в RoomConnection + joinError в useRoomBinding — подложка автоперезахода (№5) и диагностики стейл-roomId (№3)"
```

---

