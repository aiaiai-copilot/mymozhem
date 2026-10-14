### Task 7: Рефетч ростера в момент действия + по фокусу (находка №6)

**Закрывает:** UX-гарда поверх REQ-ID-006; дизайн §6. Решение владельца: без поллинга.

**Files:**
- Modify: `apps/web/src/pages/host/members-panel.tsx` (exclude с pre-refetch)
- Test: `apps/web/src/pages/host/members-panel.spec.ts` (создать)
- Create: `apps/web/src/state/focus-refetch.ts`
- Test: `apps/web/src/state/focus-refetch.spec.ts`
- Modify: `apps/web/src/state/use-room-feed.ts` (focus-effect)

**Interfaces:**
- Consumes: `listMembers`, `excludeMember` (endpoints), `hostClient` (host-session).
- Produces:
  - `excludeIfStillActive(deps, roomId, identityId): Promise<'excluded' | 'stale'>` (экспорт из members-panel.tsx);
  - `createFocusRefetcher(refetch, minIntervalMs?, now?): () => void` (экспорт из focus-refetch.ts), потребитель — use-room-feed.

- [ ] **Step 1: Падающий тест excludeIfStillActive**

Создать `members-panel.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { RosterEntry } from '@mymozhem/sdk';
import { excludeIfStillActive } from './members-panel';

// rosterEntrySchema (SDK, strict): { identityId: uuid, displayName: string|null,
// role: lowercase } — joinedAt на wire НЕТ, фикстура минимальна.
const entry = (identityId: string): RosterEntry => ({
  identityId,
  displayName: 'Игрок',
  role: 'participant',
});

// Рефетч в момент действия (находка №6): join не эмитит событий (I-3), ростер
// консоли стейл — «Исключить» по прежней identity перезашедшего бьёт мимо.
// Перед exclude ростер рефетчится; ушедшей identity exclude НЕ отправляется.
describe('excludeIfStillActive', () => {
  it('identity активна в свежем ростере → exclude отправлен (listMembers ДО exclude)', async () => {
    const calls: string[] = [];
    const deps = {
      listMembers: async (_roomId: string) => {
        calls.push('list');
        return { members: [entry('id-1')] };
      },
      excludeMember: async (_roomId: string, _identityId: string) => {
        calls.push('exclude');
      },
    };

    const result = await excludeIfStillActive(deps, 'room-1', 'id-1');

    expect(result).toBe('excluded');
    expect(calls).toEqual(['list', 'exclude']);
  });

  it('identity исчезла (перезаход) → exclude НЕ отправлен', async () => {
    const calls: string[] = [];
    const deps = {
      listMembers: async (_roomId: string) => {
        calls.push('list');
        return { members: [entry('id-new')] };
      },
      excludeMember: async (_roomId: string, _identityId: string) => {
        calls.push('exclude');
      },
    };

    const result = await excludeIfStillActive(deps, 'room-1', 'id-1');

    expect(result).toBe('stale');
    expect(calls).toEqual(['list']);
  });
});
```

(Форма `RosterEntry` верифицирована при планировании: `rosterEntrySchema` — strictObject {identityId, displayName nullable, role}; id в тестах — произвольные строки, схема-парсинг здесь не задействован.)

Run: `pnpm --filter @mymozhem/web exec vitest run src/pages/host/members-panel.spec.ts`
Expected: FAIL (экспорта нет).

- [ ] **Step 2: Реализация members-panel**

В `members-panel.tsx`:

```ts
// Оркестрация exclude с рефетчем-в-момент-действия (находка №6) — вынесена из
// компонента для теста без DOM (прецедент: чистые экспорты quiz-controls).
// 'stale' — identity уже не в активном ростере (перезаход): exclude не шлём,
// вызывающий обновляет ростер и просит выбрать заново.
export async function excludeIfStillActive(
  deps: {
    listMembers: (roomId: string) => Promise<{ members: RosterEntry[] }>;
    excludeMember: (roomId: string, identityId: string) => Promise<unknown>;
  },
  roomId: string,
  identityId: string,
): Promise<'excluded' | 'stale'> {
  const fresh = await deps.listMembers(roomId);
  if (!fresh.members.some((m) => m.identityId === identityId)) return 'stale';
  await deps.excludeMember(roomId, identityId);
  return 'excluded';
}
```

Тело `exclude` в компоненте:

```ts
  const exclude = (identityId: string) => {
    if (disabled || excludingId !== null) return; // одна команда за раз
    setExcludingId(identityId);
    setError(null);
    void excludeIfStillActive(
      {
        listMembers: (r) => listMembers(hostClient, r),
        excludeMember: (r, id) => excludeMember(hostClient, r, id),
      },
      roomId,
      identityId,
    )
      .then((result) => {
        // Стейл-ростер (№6): участник перезашёл между загрузкой и кликом —
        // показываем свежий список и просим выбрать заново, exclude не ушёл.
        if (result === 'stale') setError('Участник перезашёл — список обновлён, выберите заново.');
        onChanged();
      })
      .catch((e: unknown) => setError(excludeErrorText(e)))
      .finally(() => setExcludingId(null));
  };
```

Импорт `listMembers` добавить к `excludeMember`.

- [ ] **Step 3: Падающий тест createFocusRefetcher**

Создать `apps/web/src/state/focus-refetch.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createFocusRefetcher } from './focus-refetch';

// Дедуп рефетча по фокусу (находка №6): visibilitychange и focus приходят парой
// на одно возвращение во вкладку — ростер дёргаем не чаще minIntervalMs.
describe('createFocusRefetcher', () => {
  it('события в пределах окна → один рефетч; после окна → следующий', () => {
    const refetch = vi.fn();
    let now = 1_000;
    const onFocus = createFocusRefetcher(refetch, 2_000, () => now);

    onFocus(); // t=1000 → рефетч
    now = 2_000;
    onFocus(); // внутри окна → пропуск
    now = 3_500; // 3500-1000 = 2500 > 2000
    onFocus(); // рефетч

    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
```

Run: `pnpm --filter @mymozhem/web exec vitest run src/state/focus-refetch.spec.ts`
Expected: FAIL (модуль не существует).

- [ ] **Step 4: Реализация focus-refetch + wiring в use-room-feed**

`focus-refetch.ts`:

```ts
// Дедуп рефетча по фокусу окна (находка №6): visibilitychange→visible и focus
// приходят парой; не чаще одного вызова в minIntervalMs. Чистая фабрика —
// тест без DOM; visibility-фильтр остаётся в вызывающем (use-room-feed).
export function createFocusRefetcher(
  refetch: () => void,
  minIntervalMs = 2_000,
  now: () => number = Date.now,
): () => void {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < minIntervalMs) return;
    last = t;
    refetch();
  };
}
```

`use-room-feed.ts` — третий effect (после событийного рефетча), импорт `createFocusRefetcher`:

```ts
  // Рефетч по возврату во вкладку (находка №6): join не эмитит событий — ростер
  // стейл, пока ведущий был в другой вкладке. Без поллинга (решение владельца);
  // дедуп парных visibilitychange/focus — в createFocusRefetcher.
  useEffect(() => {
    if (!roomId) return;
    const onFocus = createFocusRefetcher(() => {
      if (document.visibilityState === 'visible') refetchMembers();
    });
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [roomId, refetchMembers]);
```

- [ ] **Step 5: Прогнать + гейты + коммит**

Run: `pnpm --filter @mymozhem/web exec vitest run src/pages/host/members-panel.spec.ts src/state/focus-refetch.spec.ts` → PASS.
Run: `pnpm --filter @mymozhem/web lint && pnpm --filter @mymozhem/web typecheck && pnpm --filter @mymozhem/web test`

```bash
git add apps/web/src/pages/host/members-panel.tsx apps/web/src/pages/host/members-panel.spec.ts apps/web/src/state/focus-refetch.ts apps/web/src/state/focus-refetch.spec.ts apps/web/src/state/use-room-feed.ts
git commit -m "fix(web): exclude с рефетчем ростера в момент действия + рефетч по фокусу окна (находка №6)"
```

---

