### Task 1: Ack-таймаут и fail-fast в RoomConnection

**Files:**
- Modify: `apps/web/src/realtime/room-connection.ts` (publish :106-113, subscribeOnce :129-137)
- Test: `apps/web/src/realtime/room-connection.spec.ts`

**Interfaces:**
- Consumes: существующий `SocketLike` (НЕ меняется), `ApiError`.
- Produces: `REQUEST_TIMEOUT_MS = 5_000` (exported, комментарий «звонок строителя, дизайн §4»); `publish` reject'ится `ApiError('NOT_CONNECTED', 0)` при мёртвом сокете и `ApiError('PUBLISH_TIMEOUT', 0)` по таймауту; `subscribeOnce` по таймауту reject'ится `ApiError('SUBSCRIBE_TIMEOUT', 0)`. Потребители кодов — T8/T9.

- [ ] **Step 1: Расширить FakeSocket** — режим «зависший ack»: `programHang(event)` — emitWithAck возвращает никогда не settle'ящийся промис (фиксирует emit в `calls`). `connected` уже есть.

- [ ] **Step 2: Падающие тесты** (vi.useFakeTimers):

```ts
it('publish: мёртвый сокет → немедленный NOT_CONNECTED без emit', async () => {
  // socket.connected = false; await expect(conn.publish(...)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  // socket.calls пуст — emit не уходил
});
it('publish: ack не пришёл за REQUEST_TIMEOUT_MS → PUBLISH_TIMEOUT', async () => {
  // programHang(PUBLISH); const p = conn.publish(...); p.catch(() => {});
  // await vi.advanceTimersByTimeAsync(5_000); rejects { code: 'PUBLISH_TIMEOUT' }
});
it('publish: поздний ack после таймаута — без unhandled rejection', async () => {
  // programHang → timeout; затем settle'им зависший промис вручную; process unhandledRejection не стреляет
  // (минимум: гонка обязана иметь .catch на проигравшей ветке — пин статически в коде + тест завершается зелёным)
});
it('subscribeOnce: зависший subscribe → SUBSCRIBE_TIMEOUT, join переходит в disconnected', async () => {
  // programHang(SUBSCRIBE); conn.join() с fake timers → joinError-путь: stateCb('disconnected')
});
```

- [ ] **Step 3: Прогон** — `pnpm --filter @mymozhem/web test -- room-connection` → новые кейсы FAIL (таймаутов нет).

- [ ] **Step 4: Реализация** — приватный хелпер `withAckTimeout(promise, ms, code): Promise<unknown>` в room-connection.ts: `Promise.race` с setTimeout-отказом; проигравшая ветка получает холостой `.catch(() => {})` (Review Focus 1). `publish`: первой строкой `if (!this.socket.isConnected()) throw new ApiError('NOT_CONNECTED', 0)`. Таймаут — `REQUEST_TIMEOUT_MS`. `subscribeOnce` — тот же хелпер.

- [ ] **Step 5: Прогон** — те же кейсы PASS; весь сьют room-connection зелёный; гейты web зелёные.

- [ ] **Step 6: Commit** — `fix(web): publish/subscribe ack-таймаут 5с + fail-fast NOT_CONNECTED (находка Н1)`.

