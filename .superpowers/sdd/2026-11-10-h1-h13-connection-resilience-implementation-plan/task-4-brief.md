### Task 4: Классификация в connect_error RoomConnection

**Files:**
- Modify: `apps/web/src/realtime/room-connection.ts` (onConnectError :59-83)
- Test: `apps/web/src/realtime/room-connection.spec.ts`

**Interfaces:**
- Consumes: `isTerminalSessionFailure` (T3).
- Produces: поведение: временный отказ refresh → `stateCb('disconnected')`, `refreshAttempted` сброшен, `onSessionDead` НЕ стреляет; терминальный → как сейчас (`onSessionDead`).

- [ ] **Step 1: Падающие тесты** (FakeSocket: refreshFn-хук программируется отказом):

```ts
it('connect_error + refresh падает TypeError (сеть) → disconnected, onSessionDead НЕ стреляет, латч сброшен', async () => {
  // joined=true; refreshReject(new TypeError('failed')); trigger connect_error
  // sessionDeadCount === 0; state === 'disconnected'
  // повторный connect_error → refresh вызван снова (латч сброшен — retry разрешён)
});
it('connect_error + refresh падает ApiError 401 → onSessionDead стреляет (прежний путь)', …);
it('online-ретрай: после временного отказа успешный refresh на второй волне → kickReconnect', …);
```

- [ ] **Step 2: Прогон** — FAIL (первый кейс: сейчас любой провал refresh → onSessionDead).

- [ ] **Step 3: Реализация** — в `.catch` refresh-хука: `if (isTerminalSessionFailure(e)) { stateCb('disconnected'); onSessionDead?.(); } else { this.refreshAttempted = false; stateCb('disconnected'); }`. Комментарий: принцип решения 4 — сеть/5xx = пауза; retry приходит по wake-каналу (T6).

- [ ] **Step 4: Прогон** — PASS; сьют зелёный; гейты.

- [ ] **Step 5: Commit** — `fix(web): сетевой провал refresh больше не убивает сессию в connect_error (находка Н13)`.

