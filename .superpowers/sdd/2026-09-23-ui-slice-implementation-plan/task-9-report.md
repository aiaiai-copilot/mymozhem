# Task 9 — отчёт: LogStore + проекции + golden-фикстура (apps/web/src/state/)

**Status:** DONE
**Commit:** `dc4be61` — `feat(web): LogStore (buffer/перефолд) + проекции через редьюсеры app-пакетов + golden-фикстура` (ветка `ui-slice`, worktree `.worktrees/ui-slice`)

## Что реализовано

Клиентская фолд-модель (дизайн §3) ровно по brief:

- **`LogStore`** (`log-store.ts`) — buffer/перефолд: live до snapshot в буфер, после — в хвост; `all()` = snapshot + buffered + live; `reset()` для пути re-subscribe. Дуп из окна handshake принят (wire без id/seq, REQ-RT-011a) и запинан тестом — дедупликации нет.
- **`projections.ts`** — `toAppLogEvent` (адаптер wire `<appId>.<short>` → `AppLogEvent` с локальными seq/recordedAt), `foldApp` (фильтр по префиксу appId + нумерация seq в порядке приёма), `projectQuiz`/`projectLottery` через редьюсеры app-пакетов, `deriveRoomStatus` (lifecycle-события, последнее побеждает, REQ-RT-010).
- **`roster-refetch.ts`** — `shouldRefetchRoster` (Review Focus 2): `quiz.question.revealed`, `quiz.game.finished`, `lottery.draw.completed`.
- **Golden-фикстура** (`fixtures/quiz-log.fixture.ts`) — рукописный `ProjectedEvent[]` мини-игры: `core.room.activated` + 2 вопроса × (open → submit ×2 → close → reveal) → `game.finished`; 2 игрока + хост. Wire-имена — полные dotted-lowercase; формы payload'ов — по zod-схемам `packages/app-quiz/src/quiz-events.ts`; uuid'ы валидные (v4).

## Сверка фактических экспортов с brief

Все имена brief совпали с фактическими, отклонений нет:
- SDK barrel: `coreEventType` (events/core-events), `RoomStatus` (room/create-room-response), `ProjectedEvent` (events/projected-event.schema), `AppLogEvent` (app-runtime/app-log-event).
- app-quiz dist: `initialQuizState`, `reduceQuiz`, `QuizState`, `QUIZ_APP_ID='quiz'`; app-lottery dist: `initialLotteryState`, `reduceLottery`, `LotteryState`, `LOTTERY_APP_ID='lottery'`. Dist актуален, пересборка не потребовалась.
- Wire-имена подтверждены манифестами: quiz (`question.opened`, `answer.submitted`, `question.closed`, `question.revealed`, `game.finished`), lottery (`draw.completed`), core (`CORE_EVENTS`).

## Тесты и результаты

- Новых тестов: **15** (log-store 3, projections 6, roster-refetch 6 через `it.each`).
- Полный прогон `pnpm --filter @mymozhem/web test`: **30/30 зелёные** (15 новых + 15 pre-existing Tasks 7–8).
- Гейты: `lint` ✓, `typecheck` ✓, `pnpm boundary-check` ✓ (669 modules, no violations; импорты web → sdk/app-quiz/app-lottery разрешены правилом `web-only-through-sdk-and-app-packages`).

## TDD Evidence

- **RED 1:** `log-store.spec.ts` без реализации → `Error: Cannot find module './log-store'` (1 failed suite, no tests).
- **GREEN 1:** после `log-store.ts` → 3/3 passed.
- **RED 2:** `projections.spec.ts` + `roster-refetch.spec.ts` без реализации → `Cannot find module './projections'` и `'./roster-refetch'` (2 failed suites).
- **GREEN 2:** после `projections.ts` + `roster-refetch.ts` → 15/15 passed по `src/state`.
- Единственная поправка после GREEN: убран неиспользуемый импорт `HOST` в projections.spec (lint), поведение тестов не менялось.

## Файлы

- `/Users/alexanderlapygin/Projects/mymozhem/.worktrees/ui-slice/apps/web/src/state/log-store.ts` / `.spec.ts`
- `/Users/alexanderlapygin/Projects/mymozhem/.worktrees/ui-slice/apps/web/src/state/projections.ts` / `.spec.ts`
- `/Users/alexanderlapygin/Projects/mymozhem/.worktrees/ui-slice/apps/web/src/state/roster-refetch.ts` / `.spec.ts`
- `/Users/alexanderlapygin/Projects/mymozhem/.worktrees/ui-slice/apps/web/src/state/fixtures/quiz-log.fixture.ts`

## Self-review findings

- Полнота: все Produces-интерфейсы brief реализованы и экспортированы; все тесты из Steps 1/3 присутствуют дословно по смыслу.
- Review Focus 2: пин тремя позитивными + тремя негативными кейсами; рефетч на subscribe оставлен потребителю (useRoomBinding, Task 10) — здесь только предикат по типу события, как в brief.
- Review Focus 3: дуп из окна handshake запинан ассертом «применён дважды» (`occurrences === 2`), не «исправлен» — комментарий в коде и тесте объясняет, что лечение — re-subscribe → reset + перефолд.
- Golden-спек проверяет порядок/адаптер, не редьюсер: дополнительно к brief-ассертам (currentQuestion, accepting, totals, finished, recordedAt) запинан локальный seq в `answers` (7 и 8 — нумерация среди quiz-событий после фильтра core), что ловит регрессию адаптера/фильтра.
- YAGNI: сверх brief добавлены только мини-тесты `projectLottery` (экспортируемая функция — покрыта поведением) и `toAppLogEvent` (срез префикса), плюс кейс `cancelled` в deriveRoomStatus (третья ветка реализации). Новых зависимостей нет, lockfile не тронут.
- Комментарии по-русски, про «почему».

## Concerns

- Нет. Открытых вопросов к владельцу задача не породила.
