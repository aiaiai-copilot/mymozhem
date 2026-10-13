### Task 7: actorId в lifecycle-эмит

**Files:**
- Modify: `packages/core/src/room/room.service.ts` (`transition`, `activate`, `complete`, `cancel`)
- Test: `packages/core/src/realtime/event-log.int-spec.ts` (добавить тест)

**Interfaces:**
- Consumes: `commitCoreEvent(tx, roomId, name, payload, actorId)` — 5-й параметр существует.
- Produces: `RoomService.transition(roomId: string, to: RoomStatus, actorId?: string | null)`, `activate/complete/cancel(roomId, actorId?)` — обратная совместимость (дефолт null), callers не ломаются.

- [ ] **Step 1: Write the failing test**

В `packages/core/src/realtime/event-log.int-spec.ts` в существующий describe добавить:

```ts
it('records actorId on lifecycle events when the caller supplies it (REQ-RT-009)', async () => {
  const ACTOR = '00000000-0000-0000-0000-0000000000c3';
  await seedIdentity(db.prisma, { id: ACTOR, email: 'actor@example.test' });
  const room = await rooms.create(ORG);
  await rooms.cancel(room.id, ACTOR);

  const log = await readRoomLog(db.prisma, room.id);
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ type: 'core.room.cancelled', actorId: ACTOR });
});
```

Импорт `seedIdentity` уже есть в файле.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mymozhem/core test:int -t "records actorId on lifecycle"`
Expected: FAIL — `rooms.cancel` принимает 1 аргумент (TS error), либо actorId в логе null. Фильтр матчит 1 тест.

- [ ] **Step 3: Thread actorId through transition**

В `packages/core/src/room/room.service.ts`:

```ts
  // actorId — актор перехода из auth-контекста вызывающего (REQ-RT-009); null у
  // вызывающих без auth-контекста (seed-скрипт, системные вызовы).
  async transition(roomId: string, to: RoomStatus, actorId: string | null = null): Promise<Room> {
```

Внутри: оба вызова `commitCoreEvent` получают 5-м аргументом `actorId` (ветка `'room.activated'` и ветка `LIFECYCLE_EVENTS[to]`). Обертки:

```ts
  activate(roomId: string, actorId: string | null = null): Promise<Room> {
    return this.transition(roomId, 'ACTIVE', actorId);
  }

  complete(roomId: string, actorId: string | null = null): Promise<Room> {
    return this.transition(roomId, 'COMPLETED', actorId);
  }

  cancel(roomId: string, actorId: string | null = null): Promise<Room> {
    return this.transition(roomId, 'CANCELLED', actorId);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mymozhem/core test:int -t "records actorId on lifecycle"` → PASS.
Run: `pnpm --filter @mymozhem/core test:int && pnpm --filter @mymozhem/server test` → зелёные (обратная совместимость callers).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/room/room.service.ts packages/core/src/realtime/event-log.int-spec.ts
git commit -m "feat(core): actorId в lifecycle-эмит через transition (REQ-RT-009, service-уровень)"
```

---

