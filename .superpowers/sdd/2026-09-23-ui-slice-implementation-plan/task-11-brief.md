### Task 11: /play — участник + shared-компоненты

**Files:**
- Create: `apps/web/src/pages/play/join-form.tsx`, `apps/web/src/pages/play/play-page.tsx`
- Create: `apps/web/src/components/standings.tsx`, `apps/web/src/components/winners.tsx`, `apps/web/src/components/connection-banner.tsx`, `apps/web/src/components/roster-names.ts`
- Modify: `apps/web/src/App.tsx` (маршруты)
- Test: `apps/web/src/components/roster-names.spec.ts`

**Interfaces:**
- Consumes: Tasks 7–10; `quizSettingsSchema`-форма settings (`questions: {text, options[]}[]`), `QuizState`.
- Produces (для Task 12 и консоли): `<Standings totals|standings names />`, `<Winners awards names />`, `<ConnectionBanner state />`, `rosterNames(members): Map<identityId, string>` (null-имя → «Гость» fallback).

- [ ] **Step 1: Failing test roster-names** (`null → 'Гость'`, обычный маппинг)

- [ ] **Step 2: Implement components** (functional-minimum, дизайн §0.4):

roster-names.ts:
```ts
import type { RosterEntry } from '@mymozhem/sdk';

// null — swept-гость (анонимизация); fallback-имя, а не пустая строка в табло.
export const rosterNames = (members: RosterEntry[]): Map<string, string> =>
  new Map(members.map((m) => [m.identityId, m.displayName ?? 'Гость']));
```

standings.tsx — таблица имя+очки из `QuizState['totals']` (сортировка desc, плотный ранг не нужен — отображение); winners.tsx — список из `lottery`-проекции (`draws: {prizeId, winnerId}[]` + roster-имена); connection-banner.tsx — «Нет соединения…» при `state !== 'live'`.

- [ ] **Step 3: Implement join-form + play-page**

join-form.tsx: поля код (из `:code` параметра, если есть — read-only отображение) + displayName → `joinRoom(client, { code, displayName })` → `session.setAccessToken(res.accessToken)`, `SessionStore.saveGuest`, `onJoined(roomId из decodeAccessClaims)`.

play-page.tsx (каркас):

```tsx
export function PlayPage(): JSX.Element {
  const { code } = useParams();
  const saved = SessionStore.loadGuest();
  const [session] = useState(() => new SessionStore(async () => (await refreshSession(anonClient)).accessToken));
  const [roomId, setRoomId] = useState<string | null>(null);
  // guest join: session.setAccessToken → claims.roomId → setRoomId; при протухшей сессии —
  // повторный join по saved (дизайн §5: новая identity, «вы вошли заново»).
  const binding = useRoomBinding(roomId, session);
  const quiz = projectQuiz(binding.events, /* receivedAt */ new Date().toISOString());
  const status = deriveRoomStatus(binding.events);
  const myId = /* decodeAccessClaims(session.getAccessToken()).sub */;
  // roster: listMembers на subscribe + shouldRefetchRoster по событиям (Task 9)
  // views: status !== 'ACTIVE' → Lobby; quiz.accepting → QuestionView; reveal → Result;
  // quiz.finished → Finished (+Winners). QuestionView: options из appSettings.questions
  // [quiz.currentQuestion], publish 'quiz.answer.submitted' { questionIndex, optionIndex };
  // ack ok → «Ответ принят»; ApiError → текст кода.
}
```

(Компонент пишется целиком исполнителем по этому каркасу; все ветки из дизайна §4 — лобби/вопрос/reveal/финал + ConnectionBanner.)

- [ ] **Step 4: Run** — unit зелёный, typecheck, `pnpm --filter @mymozhem/web build`

- [ ] **Step 5: Commit** — `feat(web): страница участника /play + shared-компоненты (standings/winners/banner)`

