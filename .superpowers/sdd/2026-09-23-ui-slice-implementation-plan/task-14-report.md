# Task 14 — отчёт исполнителя

Консоль ведущего: ведение квиза (open/close/finish), счётчик ответов, табло, код комнаты с копируемыми ссылками.

## Что построено

| Файл | Содержимое |
|---|---|
| `apps/web/src/pages/host/quiz-controls.tsx` | Селекторы `nextQuestionIndex(quiz)` (`currentQuestion === null ? 0 : +1`) и `answersCount(events, qi)` — distinct actorId среди публичных `quiz.answer.accepted` (переиспользует `projectAnsweredActors`; `answer.submitted` module-private и не трогается). Компонент `QuizControls`: «Открыть вопрос N» (disabled пока `accepting`, N = nextQuestionIndex и в label, и в payload), «Закрыть вопрос» (enabled только пока accepting), счётчик «Ответов: N», после reveal — `<Standings totals>`, «Завершить квиз» → `quiz.game.finish` → финальный `<Standings standings>` (места из payload `game.finished`). Кнопок reveal нет — reveal/finished коммитит модуль. |
| `apps/web/src/pages/host/console-page.tsx` | Гейт: без roomId или access-токена → `navigate('/host', { replace: true })`. Переиспользует `hostSession`/`hostClient` (Task 13), второй SessionStore не заводится. `useRoomBinding` + `useRoomFeed`. Код комнаты крупно + текстовые ссылки `/play/<code>` и `/screen/<code>` с кнопками «Копировать» (`navigator.clipboard`, без router-Link — one-shot join в play/screen не перезапускается на смену `:code` внутри SPA). `ConnectionBanner`, строка «Комната отменена.» при CANCELLED. Ошибки publish → `Команда не выполнена (<ApiError.code>).` (паттерн answerErrorText). |
| `apps/web/src/state/use-room-feed.ts` | Общий клей (ruling): members state + начальный `listMembers` на roomId + событийный рефетч по `shouldRefetchRoster` + `rosterNames` memo + проекции quiz/lottery/status (memo по events). Консоль — первый потребитель; play/screen НЕ мигрированы (отдельный follow-up). |
| `apps/web/src/state/session.ts` | `loadHostRoomCode/saveHostRoomCode` (`mm.host.roomCode`) — HTTP-контракт не отдаёт code по roomId, единственный момент получить код — createRoom-ответ. |
| `apps/web/src/pages/host/setup-page.tsx` | +2 строки: `saveHostRoomCode(r.code)` рядом с `saveHostRoomId` при createRoom. |
| `apps/web/src/App.tsx` | Placeholder `<p>tbd</p>` на `/host/console` заменён на `<ConsolePage>` (ruling). |

## TDD-доказательства

1. **Red**: `quiz-controls.spec.ts` написан до реализации, прогон — 1 file failed / 53 passed (модуль `./quiz-controls` не существует).
2. **Green**: `pnpm --filter @mymozhem/web test` → **9 files, 61 tests passed** (+8: 5 answersCount — distinct actorId, дедуп повторного accept, игнор других вопросов, игнор module-private `answer.submitted`, ноль без accepted; 3 nextQuestionIndex — null→0, 0→1, 3→4).
3. **Остальные гейты** (из корня worktree):
   - `pnpm --filter @mymozhem/web typecheck` — чисто.
   - `pnpm --filter @mymozhem/web lint` — чисто.
   - `pnpm --filter @mymozhem/web build` — успех (warning chunk >500 kB — существующий).
   - `pnpm boundary-check` — no dependency violations (690 modules).
   - `pnpm guardrails` — All guardrails verified alive.

## Коммит

`8f4f024 feat(web): консоль ведущего — ведение квиза (open/close/finish, счётчик, табло)` — 7 файлов, +362/−3.

## Отклонения от брифа

- **Код комнаты сохраняется в localStorage** (`saveHostRoomCode` в setup-page): бриф требует показывать код и ссылки, но HTTP-контракт не отдаёт code по roomId (нет GET /rooms/:id; snapshot realtime code не несёт). Без этого консоль после перезагрузки не могла бы показать код. Пара `saveHostRoomId/saveHostRoomCode` пишется атомарно в одном `.then` createRoom.
- **Label кнопки «Открыть вопрос N»** использует N из формулы брифа буквально (0-based: первый вопрос — «Открыть вопрос 0»), то же значение уходит в payload. Human-facing нумерация вопросов в строке состояния («Идёт вопрос 1») — 1-based, как в play/screen.
- Новый файл `use-room-feed.ts` — прямой ruling контроллера (третий потребитель клея); миграция play/screen сознательно не делалась.

## Саморевью

- Все хуки безусловны и до любого раннего return (ConsolePage: useState×4, useEffect, useRoomBinding, useRoomFeed — до `if (!roomId)`; QuizControls: useMemo×3 — до `if (quiz.finished)`).
- Новых зависимостей нет; react 18.3.1 / react-router-dom 6.30.6 не тронуты.
- apps/web импортирует только @mymozhem/sdk и @mymozhem/app-* (boundary-check зелёный).
- `quiz.answer.submitted` в клиентской логике не используется — счётчик только по публичным `quiz.answer.accepted` (есть тест-пин).
- Комментарии по-русски про «почему»; разметка functional-minimum.

## Замечания для Task 15

- `useRoomFeed` уже возвращает `lottery` и `members` — панелям Task 15 (розыгрыш, участники) не нужен свой клей.
- Кнопка «Завершить квиз» (app-уровень) уже есть; «Завершить событие» (completeRoom, ядро) — Task 15, не путать.
