# Fix report — финревью батча 4 (UI-срез), fix-волна

Коммит: `2a33aae` — `fix(web): reveal-вердикт из публичного answer.accepted + refresh токена при reconnect (UI-срез, финревью батча 4)`

Обе находки исправлены по TDD (RED → GREEN), только в `apps/web` — серверные пакеты не тронуты.

## Finding 1 — Critical: мёртвый reveal-вердикт

**Что изменено:**

- `apps/web/src/state/projections.ts` — новая клиентская проекция `projectAnsweredActors(events, questionIndex): ReadonlySet<string>`: фолдит публичные `quiz.answer.accepted` (payload `{questionIndex, actorId}`, схема `answerAcceptedPayload` — wire-имя и форма сверены с `packages/app-quiz/src/quiz-events.ts:11-14` и манифестом, visibility `public`). Shared `reduceQuiz` не тронут (он легитимно игнорирует accept). Проекция безсостоянная — переживает перефолд/reload (accept едет в snapshot).
- `apps/web/src/pages/play/play-page.tsx:209-219` — мёртвый `quiz.answers[myId]` заменён на `answeredActors.has(myId)`; `answered = answerAck || myAnswered`.
- `apps/web/src/pages/play/play-page.tsx` (reveal-ветка) — вердикт: не ответил → «Вы не успели ответить.»; `correctIndex === undefined` → «Ответ принят.» (сохранена ветка вопроса без правильного ответа); `myId ∈ reveal.awarded` → «Верно!»; иначе → «Неверно.»
- screen-page проверен: мёртвого пути нет (использует только `reveal.correctIndex`/`totals` из публичного payload).
- Побочный эффект, как предсказывал ревью: после reload кнопки ответа скрыты (accept в snapshot) — починен путь reload-double-answer.

**Тесты:** `apps/web/src/state/projections.spec.ts` — describe `projectAnsweredActors`, 3 теста (фолд accept вопроса; игнор других вопросов/не-accept/чужого appId-префикса и module-private `answer.submitted`; переживание перефолда).

## Finding 2 — Important: reconnect после истечения access-TTL не восстанавливается

**Что изменено:**

- `apps/web/src/realtime/socket-like.ts` — в `SocketLike` добавлен `onConnectError(cb)`; `createSocket` мапит на `socket.on('connect_error')` (отказ handshake gateway auth-middleware'ем — `SESSION_INVALID`, сверено с `realtime.gateway.ts:84-91`).
- `apps/web/src/realtime/room-connection.ts` — опциональный третий параметр конструктора `refreshAccessToken?: () => Promise<void>` (инжекция по существующему паттерну). На `connect_error` при `joined === true` — ровно один refresh на стрик обрыва (флаг `refreshAttempted`, сбрасывается на успешном `connect`); причина по `err` не фильтруется (gateway отвечает одним SESSION_INVALID на любой auth-отказ — комментарий в коде). Провал refresh → явный `'disconnected'` (тот же контракт, что у упавшего re-subscribe). До join и без хука — no-op.
- `apps/web/src/state/use-room-binding.ts:30-36` — подключён `() => tokens.refresh()`; после успешного refresh очередной retry socket.io перечитывает свежий токен через auth-колбэк.

**Тесты:** `apps/web/src/realtime/room-connection.spec.ts` — 5 новых тестов (один refresh на стрик при серии connect_error; новый стрик после успешного reconnect снова тянет refresh; connect_error до join — без refresh; упавший refresh → `'disconnected'` без повторных попыток; без хука — no-op). `FakeSocket` расширен `onConnectError`/`triggerConnectError`.

## Команды и вывод

RED (после тестов, до реализации):

```
$ pnpm --filter @mymozhem/web test
 FAIL  src/state/projections.spec.ts > projectAnsweredActors (3 теста — projectAnsweredActors is not a function)
 FAIL  src/realtime/room-connection.spec.ts (3 теста — onConnectError/refresh отсутствуют)
 Test Files  2 failed | 5 passed (7)
      Tests  6 failed | 43 passed (49)
```

GREEN (после реализации):

```
$ pnpm --filter @mymozhem/web test
 Test Files  7 passed (7)
      Tests  49 passed (49)

$ cd apps/web && pnpm typecheck   # tsc --noEmit — чисто
$ pnpm lint                       # eslint src — чисто
$ pnpm build                      # vite build ✓ (warning о chunk >500 kB — пре-экзистинг)
```

---

## Дофикс: порядок хуков в play-page (rules-of-hooks)

Коммит `d71022c` — fix-коммитом предыдущей волны `answeredActors = useMemo(...)` оказался ПОСЛЕ условного early return `if (!roomId) { ... }` → на переходе `roomId: null → set` React бросал «Rendered more hooks than during the previous render», страница падала на каждом входе в комнату.

**Что куда:** блок «quiz.answers на клиенте ВСЕГДА пуст…» + `answeredActors = useMemo(...)` перенесён из-под early return (бывш. строки 209-218) наверх, перед `submitAnswer` (после effect'а сброса answerAck) — все хуки теперь безусловны. Зависимости мемо (`events`, `currentQuestion`) и так вычислялись выше early return, дополнительного подъёма не потребовалось. Логика не менялась, только размещение. Остальной компонент проверен: других хуков после условных return нет.

**Команды и вывод:**

```
$ pnpm --filter @mymozhem/web test
 Test Files  7 passed (7)
      Tests  49 passed (49)

$ pnpm --filter @mymozhem/web typecheck   # tsc --noEmit — чисто
$ pnpm --filter @mymozhem/web build       # vite build ✓ (warning о chunk >500 kB — пре-экзистинг)
```
