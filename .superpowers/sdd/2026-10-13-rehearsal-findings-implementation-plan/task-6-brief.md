### Task 6: Стейл-roomId в консоли (находка №3)

**Закрывает:** UX-фикс без REQ; дизайн §7.

**Files:**
- Modify: `apps/web/src/pages/host/console-page.tsx`
- Test: `apps/web/src/pages/host/console-page.spec.ts` (создать — чистый предикат)

**Interfaces:**
- Consumes: `binding.joinError` (Task 4), `SessionStore.clearHostRoom()` (Task 3).
- Produces: `isStaleRoomJoinError(code: string | null): boolean` (экспорт из console-page.tsx).

- [ ] **Step 1: Падающий тест предиката**

Создать `console-page.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isStaleRoomJoinError } from './console-page';

// Стейл-roomId (находка №3): комната из прошлой БД → join отказывает
// ACTOR_NOT_MEMBER; консоль обязана показать «комната не найдена», а не
// вечный «Нет соединения». NOT_FOUND — на случай будущего REST-восстановления
// комнаты; сетевые отказы (null) сюда не попадают.
describe('isStaleRoomJoinError', () => {
  it('ACTOR_NOT_MEMBER и NOT_FOUND → true', () => {
    expect(isStaleRoomJoinError('ACTOR_NOT_MEMBER')).toBe(true);
    expect(isStaleRoomJoinError('NOT_FOUND')).toBe(true);
  });

  it('прочие коды и null (сеть) → false', () => {
    expect(isStaleRoomJoinError('ROOM_NOT_ACTIVE')).toBe(false);
    expect(isStaleRoomJoinError('SESSION_INVALID')).toBe(false);
    expect(isStaleRoomJoinError(null)).toBe(false);
  });
});
```

Run: `pnpm --filter @mymozhem/web exec vitest run src/pages/host/console-page.spec.ts`
Expected: FAIL (экспорта нет).

- [ ] **Step 2: Реализация**

`console-page.tsx`:

1. Экспорт предиката (до компонента):

```ts
// Стейл-roomId (находка №3): сохранённая комната из прошлой БД — join отказывает
// ACTOR_NOT_MEMBER; это «комнаты нет», а не «нет соединения».
export const isStaleRoomJoinError = (code: string | null): boolean =>
  code === 'ACTOR_NOT_MEMBER' || code === 'NOT_FOUND';
```

2. Состояние и effect (хуки — рядом с существующими, до рендер-веток):

```ts
  const [roomGone, setRoomGone] = useState(false);

  // Однократно на переход joinError: ключи снимаем атомарно (clearHostRoom),
  // иначе следующий заход на /host снова приведёт в мёртвую комнату.
  useEffect(() => {
    if (isStaleRoomJoinError(binding.joinError)) {
      SessionStore.clearHostRoom();
      setRoomGone(true);
    }
  }, [binding.joinError]);
```

3. Рендер-ветка СРАЗУ ПОСЛЕ существующей `if (!roomId)`:

```tsx
  if (roomGone) {
    return (
      <main>
        <h1>Комната не найдена</h1>
        <p>Сохранённая комната больше не существует (стенд был пересоздан). Создайте новую.</p>
        <p>
          <a href="/host/setup">К настройке комнаты</a>
        </p>
      </main>
    );
  }
```

- [ ] **Step 3: Прогнать + гейты + коммит**

Run: `pnpm --filter @mymozhem/web exec vitest run src/pages/host/console-page.spec.ts` → PASS.
Run: `pnpm --filter @mymozhem/web lint && pnpm --filter @mymozhem/web typecheck && pnpm --filter @mymozhem/web test`

```bash
git add apps/web/src/pages/host/console-page.tsx apps/web/src/pages/host/console-page.spec.ts
git commit -m "fix(web): консоль диагностирует стейл-roomId — «комната не найдена» + очистка ключей (находка №3)"
```

---

