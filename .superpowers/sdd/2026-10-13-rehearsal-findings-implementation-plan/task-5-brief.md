### Task 5: Автоперезаход play-page и screen-page (находка №5)

**Закрывает:** REQ-ID-016-контур, UX поверх REQ-ID-003; дизайн §5.

**Files:**
- Create: `apps/web/src/state/guest-rejoin.ts`
- Test: `apps/web/src/state/guest-rejoin.spec.ts`
- Modify: `apps/web/src/pages/play/play-page.tsx` (rejoin выделен + onSessionDead)
- Modify: `apps/web/src/pages/screen/screen-page.tsx` (join выделен + onSessionDead)

**Interfaces:**
- Consumes: `useRoomBinding(roomId, tokens, { onSessionDead })` (Task 4), `joinRoom` (endpoints), `decodeAccessClaims`/`SessionStore` (session.ts).
- Produces: `rejoinAsGuest(client: ApiClient, saved: GuestSession): Promise<{ accessToken: string; roomId: string }>` — потребителей в плане нет, кроме play-page.

- [ ] **Step 1: Падающий тест rejoinAsGuest**

Создать `apps/web/src/state/guest-rejoin.spec.ts` (fetch-стаб — по образцу api-client.spec.ts; makeToken — по образцу session.spec.ts):

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api-client';
import { rejoinAsGuest } from './guest-rejoin';

const makeToken = (claims: unknown): string =>
  `hdr.${btoa(JSON.stringify(claims))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}.sig`;

const anon = new ApiClient({ getAccessToken: () => null, refresh: () => Promise.resolve() });

// Автоперезаход (находка №5): мёртвая refresh-кука → новый join по сохранённым
// code/displayName. roomId берём из claims нового токена, а не из ответа формы —
// одна точка правды с авто-входом §5.
describe('rejoinAsGuest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('join по сохранённым code/displayName → accessToken + roomId из claims', async () => {
    const token = makeToken({ sub: 'id-1', kind: 'GUEST', roomId: 'room-9' });
    const fetchMock = vi.fn(async () =>
      new Response(
        // joinResponseSchema (SDK 2.0.0, strict): tokenResponse + displayName;
        // refreshToken в теле НЕТ — refresh живёт в httpOnly-куке.
        JSON.stringify({ accessToken: token, tokenType: 'Bearer', expiresIn: 900, displayName: 'Гость 7' }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await rejoinAsGuest(anon, { code: 'ABCD-2345', displayName: 'Гость 7' });

    expect(res).toEqual({ accessToken: token, roomId: 'room-9' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ code: 'ABCD-2345', displayName: 'Гость 7' });
  });

  it('токен без roomId → throw (fail-loud, не тихий null)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            accessToken: makeToken({ sub: 'id-1', kind: 'GUEST' }),
            tokenType: 'Bearer',
            expiresIn: 900,
            displayName: 'x',
          }),
          { status: 201 },
        ),
      ),
    );

    await expect(rejoinAsGuest(anon, { code: 'C', displayName: 'x' })).rejects.toThrow('roomId');
  });
});
```

(Формы верифицированы при планировании: `joinResponseSchema` = strictObject tokenResponse {accessToken, tokenType:'Bearer', expiresIn} + displayName; fetch-стаб через глобальный Response — как в api-client.spec.ts.)

- [ ] **Step 2: Прогнать — должно падать**

Run: `pnpm --filter @mymozhem/web exec vitest run src/state/guest-rejoin.spec.ts`
Expected: FAIL (модуль не существует).

- [ ] **Step 3: Реализация guest-rejoin.ts**

```ts
import type { ApiClient } from '../api/api-client';
import { joinRoom } from '../api/endpoints';
import { decodeAccessClaims, type GuestSession } from './session';

// Автоперезаход при мёртвой сессии (находка №5): refresh-кука мертва → новый
// join по сохранённым code/displayName = НОВАЯ identity, очки не переносятся
// (тот же контракт, что авто-вход дизайна §5, — там тот же путь на загрузке
// страницы). Вызывающий показывает баннер «вы вошли заново».
export async function rejoinAsGuest(
  client: ApiClient,
  saved: GuestSession,
): Promise<{ accessToken: string; roomId: string }> {
  const res = await joinRoom(client, { code: saved.code, displayName: saved.displayName });
  const claims = decodeAccessClaims(res.accessToken);
  if (!claims.roomId) throw new Error('join token without roomId');
  return { accessToken: res.accessToken, roomId: claims.roomId };
}
```

Run: `pnpm --filter @mymozhem/web exec vitest run src/state/guest-rejoin.spec.ts` → PASS.

- [ ] **Step 4: play-page — rejoin выделен, onSessionDead подключён**

В `play-page.tsx`:

1. Импорт `rejoinAsGuest` из '../../state/guest-rejoin'.
2. Добавить refs/колбэк (рядом с autoJoinStarted):

```ts
  const rejoinInFlight = useRef(false);

  // Перезаход с новой identity (находка №5): общий путь для авто-входа §5
  // (TTL протух на загрузке) и onSessionDead (кука умерла на живой странице).
  // Гард: один перезаход в полёте — повторный onSessionDead не плодит identity.
  const rejoin = useCallback(async () => {
    const s = SessionStore.loadGuest();
    if (!s || rejoinInFlight.current) return;
    rejoinInFlight.current = true;
    try {
      const res = await rejoinAsGuest(anonClient, s);
      session.setAccessToken(res.accessToken);
      setRejoined(true);
      setRoomId(res.roomId);
    } catch {
      // Сохранённое больше не валидно (комната удалена/закрыта) — забываем
      // его и честно показываем форму, а не вечный «Входим…».
      SessionStore.clearGuest();
      setSaved(null);
      setAutoJoinError('Сохранённая сессия недействительна. Войдите заново.');
    } finally {
      rejoinInFlight.current = false;
    }
  }, [session]);
```

3. Mount-effect: catch-ветку (блок joinRoom inline, ~стр. 86-92) заменить на `await rejoin();` — текст ошибки и поведение сохраняются (теперь внутри rejoin). Добавить `rejoin` в deps effect.
4. Binding:

```ts
  const binding = useRoomBinding(roomId, session, {
    onSessionDead: useCallback(() => {
      // Rebind при том же roomId (Review Focus 1): React не перезапустит effect
      // при одинаковом значении deps — сначала отвязываемся (cleanup закроет
      // мёртвое соединение), rejoin следующим тиком установит roomId заново.
      setRoomId(null);
      setTimeout(() => void rejoin(), 0);
    }, [rejoin]),
  });
```

Хуки — до любых условных return (в файле их нет до binding, порядок сохранить).

- [ ] **Step 5: screen-page — то же для spectator**

В `screen-page.tsx` (текущий one-shot join ~стр. 61-86):

1. `joinStarted` ref заменить на `joinInFlight` (сбрасывается в finally) — перезаходу нужен повторный вход; StrictMode-перекрытие по-прежнему отсекает параллельный дубль.
2. Тело effect выделить в `joinSpectator = useCallback(...)` (deps `[code, session]`), в начале `setJoinError(null);`.
3. Effect: `useEffect(() => { void joinSpectator(); }, [joinSpectator]);`
4. Binding:

```ts
  const binding = useRoomBinding(roomId, session, {
    onSessionDead: useCallback(() => {
      // См. play-page: отвязка → перезаход следующим тиком (rebind при том же roomId).
      setRoomId(null);
      setTimeout(() => void joinSpectator(), 0);
    }, [joinSpectator]),
  });
```

Комментарий у onSessionDead: spectator перезаход = новый spectator 'Экран', saveGuest не трогаем (существующий контракт страницы: зритель не затирает guest-сессию).

- [ ] **Step 6: Гейты + коммит**

Run: `pnpm --filter @mymozhem/web lint && pnpm --filter @mymozhem/web typecheck && pnpm --filter @mymozhem/web test`
Expected: зелёные. Ручная верификация wiring перенесена в приёмку (строка 12.2 чеклиста) — страницы без DOM-тестов (нет @testing-library/react, известный deferred).

```bash
git add apps/web/src/state/guest-rejoin.ts apps/web/src/state/guest-rejoin.spec.ts apps/web/src/pages/play/play-page.tsx apps/web/src/pages/screen/screen-page.tsx
git commit -m "fix(web): автоперезаход при мёртвой сессии — onSessionDead → rejoin без перезагрузки (находка №5)"
```

---

## Батч C (консоль + автоматика): Tasks 6–8

