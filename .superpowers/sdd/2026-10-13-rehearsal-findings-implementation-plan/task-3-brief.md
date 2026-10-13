### Task 3: Single-flight refresh + `clearHostRoom` (находка №4, пин A3)

**Закрывает:** REQ-ID-016-контур (сессии; strict-ротация не смягчается); дизайн §4 + §8.3.

**Files:**
- Test: `apps/web/src/state/session.spec.ts` (добавить кейсы)
- Modify: `apps/web/src/state/session.ts` (`refresh()`, + `clearHostRoom()`)

**Interfaces:**
- Consumes: существующий `SessionStore` (конструктор с `refreshFn: () => Promise<string>`).
- Produces: `SessionStore.refresh()` — single-flight (конкурентные вызовы делят один запрос); `SessionStore.clearHostRoom(): void` — потребитель Task 6.

- [ ] **Step 1: Падающие тесты single-flight**

В `session.spec.ts`, в `describe('SessionStore')`:

```ts
  it('single-flight: конкурентные refresh() делят один вызов refreshFn (находка №4)', async () => {
    // HostGate + 401-retry ApiClient + refresh-хук RoomConnection могут дёрнуть
    // refresh одновременно с ОДНОЙ refresh-кукой; strict-ротация видит повторное
    // предъявление и гасит семью («rotation race lost» на репетиции 2026-10-13).
    let calls = 0;
    let resolveFn!: (token: string) => void;
    const store = new SessionStore(
      () =>
        new Promise<string>((resolve) => {
          calls += 1;
          resolveFn = resolve;
        }),
    );

    const p1 = store.refresh();
    const p2 = store.refresh();
    const p3 = store.refresh();
    resolveFn('tok-1');
    await Promise.all([p1, p2, p3]);

    expect(calls).toBe(1);
    expect(store.getAccessToken()).toBe('tok-1');
  });

  it('после settle следующий refresh вызывает refreshFn снова', async () => {
    let calls = 0;
    const store = new SessionStore(() => {
      calls += 1;
      return Promise.resolve(`tok-${calls}`);
    });

    await store.refresh();
    await store.refresh();

    expect(calls).toBe(2);
    expect(store.getAccessToken()).toBe('tok-2');
  });

  it('провал refresh не затирает токен и не блокирует следующую попытку (Review Focus 2)', async () => {
    let calls = 0;
    const store = new SessionStore(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('network')) : Promise.resolve('tok-recovered');
    });
    store.setAccessToken('tok-old');

    await expect(store.refresh()).rejects.toThrow('network');
    expect(store.getAccessToken()).toBe('tok-old'); // провал ≠ потеря токена

    await store.refresh(); // retry разрешён: мемо сброшен и на reject
    expect(store.getAccessToken()).toBe('tok-recovered');
    expect(calls).toBe(2);
  });

  it('clearHostRoom: сносит оба host-ключа (потребитель — консоль, находка №3)', () => {
    SessionStore.saveHostRoomId('room-1');
    SessionStore.saveHostRoomCode('ABCD-2345');

    SessionStore.clearHostRoom();

    expect(SessionStore.loadHostRoomId()).toBeNull();
    expect(SessionStore.loadHostRoomCode()).toBeNull();
  });
```

- [ ] **Step 2: Прогнать — должно падать**

Run: `pnpm --filter @mymozhem/web exec vitest run src/state/session.spec.ts`
Expected: FAIL (кейсы 1 и 3 — `calls === 3` вместо 1 / мемо отсутствует; кейс 4 — `clearHostRoom` не функция).

- [ ] **Step 3: Реализация**

В `session.ts` — поле и новый `refresh()`:

```ts
  // Single-flight (находка №4): конкурентные refresh (HostGate, 401-retry
  // ApiClient, refresh-хук RoomConnection) шлют ОДНУ refresh-куку; strict-ротация
  // читает повторное предъявление как кражу и гасит семью. In-flight промис
  // мемоизируется: конкуренты делят один запрос. Мемо сбрасывается на ЛЮБОМ
  // settle — retry после провала разрешён, следующий refresh работает.
  private inFlightRefresh: Promise<void> | null = null;

  async refresh(): Promise<void> {
    this.inFlightRefresh ??= this.refreshFn()
      .then((token) => {
        this.accessToken = token;
      })
      .finally(() => {
        this.inFlightRefresh = null;
      });
    return this.inFlightRefresh;
  }
```

и статический метод рядом с `saveHostRoomCode`:

```ts
  // Стейл-roomId консоли (находка №3): комната из прошлой БД — оба ключа
  // снимаются атомарно, чтобы гейт не увидел половину состояния.
  static clearHostRoom(): void {
    localStorage.removeItem(HOST_ROOM_KEY);
    localStorage.removeItem(HOST_ROOM_CODE_KEY);
  }
```

- [ ] **Step 4: Прогнать — зелёное**

Run: `pnpm --filter @mymozhem/web exec vitest run src/state/session.spec.ts`
Expected: PASS (все кейсы, включая 4 существующих).

- [ ] **Step 5: Гейты + коммит**

Run: `pnpm --filter @mymozhem/web lint && pnpm --filter @mymozhem/web typecheck && pnpm --filter @mymozhem/web test`

```bash
git add apps/web/src/state/session.ts apps/web/src/state/session.spec.ts
git commit -m "fix(web): single-flight refresh в SessionStore — конкурентные refresh делят один запрос (находка №4, rotation race)"
```

---

