# Fix report — финревью батча 5 (UI-срез), fix-волна

Коммит: `e4484c6` — `fix(web): OAuth redirect absolute URL + фолбэки консоли (UI-срез, финревью батча 5)`

Все 7 находок исправлены, только в `apps/web` — серверные пакеты не тронуты.

## F1 — Critical: относительный OAuth redirect на лендинге

**Что изменено:** `apps/web/src/pages/landing.tsx:36-49` — `redirect` теперь абсолютный: `encodeURIComponent(`${window.location.origin}/host`)`. Комментарий объясняет ПОЧЕМУ: `OAUTH_REDIRECT_ALLOWLIST` парсится как `z.array(z.url())` (`packages/core/src/config/config.schema.ts:62-70`), а `OAuthService.validateRedirect` — точное строковое совпадение (`packages/core/src/oauth/oauth.service.ts:124-135`) — относительный `/host` не проходит ни при одной конфигурации. Same-origin по дизайну §0.3, поэтому origin берётся из `location`. Ride-along: навигация по коду комнаты — `navigate(\`/play/${encodeURIComponent(trimmed)}\`)` с why-комментарием.

**Тесты:** покрытия лендинга не было и не добавлено (в web нет DOM-harness; изменение — чистая строковая композиция URL).

## F2 — Important: синхронный бросок crypto.randomUUID() умирал молча

**Что изменено:** `apps/web/src/pages/host/prizes-panel.tsx` — новый экспортируемый шов `tryStartDrawAttempt(prize, pending, makeDrawId): { attempt, error }`: оборачивает `startDrawAttempt` в try/catch; бросок (crypto.randomUUID недоступен вне secure context — plain-HTTP LAN) превращается в текст `DRAW_ID_GENERATION_FAILED` («…нужен HTTPS или localhost»), попытка не создаётся. `runDraw` (`prizes-panel.tsx:143-161`) на `startError` кладёт текст в существующий `error`-стейт панели (рендер `role="alert"`) и возвращается — `pendingDraw` не ставится, залипания нет. Фолбэк-генератор НЕ заведён: единственный разрешённый источник drawId — `crypto.randomUUID()` (глобальный констрейнт), замена потребовала бы решения владельца.

**Тесты:** `apps/web/src/pages/host/prizes-panel.spec.ts` — новый describe `tryStartDrawAttempt`, 3 теста: генератор бросает → `error` всплывает, `attempt === null` (pending не залипнет); бросающий генератор при уже pending-попытке → ни броска, ни вызова генератора (не re-called); успешная генерация → прозрачный pass-through.

## F3 — Important: футганы конца жизни квиза

**Что изменено:** `apps/web/src/pages/host/quiz-controls.tsx`:
- (a) «Завершить квиз» получил `window.confirm('Завершить квиз? Это действие необратимо.')` — симметрично «Завершить событие» на console-page (game.finish необратим серверно).
- (b) «Открыть вопрос N» глушится при исчерпании колоды: `appSettings` проброшено пропом из console-page (`binding.appSettings`), колода парсится `quizSettingsSchema.shape.questions.safeParse(appSettings.questions)` — тот же паттерн, что play-page.tsx:156; `deckExhausted = next >= questions.length` входит в `disabled` кнопки. useMemo до early return — хуки безусловны.

## F4 — fix-before-merge minor: 1-based подпись

**Что изменено:** та же кнопка: подпись «Открыть вопрос {next + 1}» (1-based для ведущего, как статус-строка выше), payload остался 0-based (`questionIndex: next` — так ждёт модуль). Комментарий обновлён: явно разведены подпись и payload.

## F5 — minor: терминальный гейт пульта

**Что изменено:** `apps/web/src/pages/host/console-page.tsx:146-155` — `QuizControls` получил `disabled={terminal}` (симметрия с Members/Prizes на :158,:164); в quiz-controls все командные кнопки учитывают `disabled` (open: `disabled || quiz.accepting || deckExhausted`; close: `disabled || !quiz.accepting || current === null`; finish: `disabled`).

## F6 — minor: catch-all маршрут

**Что изменено:** `apps/web/src/App.tsx` — `<Route path="*" element={<NotFoundPage />} />`; новый `apps/web/src/pages/not-found.tsx` — минимальная 404 («Страница не найдена» + `<Link to="/">` на главную; Link, не `<a>` — маршрут внутри SPA).

## F7 — minor: протухший комментарий про код комнаты

**Что изменено:** `apps/web/src/state/session.ts:19-23` и `apps/web/src/pages/host/setup-page.tsx:66-69` — убрано неверное «код есть только в createRoom-ответе»: код приезжает и в ответах lifecycle (configure/activate/complete/cancel — `toRoomResponse`, `packages/core/src/transport/rooms-lifecycle.controller.ts:75-80`, сверено). Решение о персистентности стоит: endpoint'а «прочитать комнату по roomId» нет (проверено по всем @Get/@Post в transport), после перезагрузки консоли код перечитать неоткуда.

## Команды и вывод

```
$ pnpm --filter @mymozhem/web test
 Test Files  10 passed (10)
      Tests  69 passed (69)   # было 66 — +3 новых теста tryStartDrawAttempt

$ pnpm --filter @mymozhem/web typecheck   # tsc --noEmit — чисто
$ pnpm --filter @mymozhem/web lint        # eslint src — чисто
$ pnpm --filter @mymozhem/web build       # vite build ✓ (warning о chunk >500 kB — пре-экзистинг)

$ pnpm boundary-check                     # depcruise: no dependency violations (695 modules)
$ pnpm guardrails                         # All guardrails verified alive (8/8)
```

quiz-controls.spec.ts не потребовал правок: покрывает чистые `nextQuestionIndex`/`answersCount`, семантика которых не менялась (подпись/disable — рендер-уровень, DOM-harness в web отсутствует); 69/69 зелёные без удаления покрытия.

## Concerns

- До приезда snapshot `appSettings === {}` → колода парсится как `[]` → кнопка «Открыть вопрос 1» transient-disabled до загрузки настроек. Это честно (модуль всё равно отклонил бы open вне диапазона) и кратковременно, но является изменением поведения на старте консоли — зафиксировано здесь явно.
- Текст `DRAW_ID_GENERATION_FAILED` упоминает HTTPS/localhost — причина вне secure context; если всплывёт иной синхронный бросок генератора, текст останется правдоподобным, но не точным. Диагностического риска на MVP не видим.
