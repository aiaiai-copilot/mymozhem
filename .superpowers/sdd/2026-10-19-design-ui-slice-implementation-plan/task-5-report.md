# Task 5 report: Таймер — чистая логика + хук

## What was implemented

`apps/web/src/state/question-timer.ts` — чистый вычислительный модуль таймера вопроса поверх контракта quiz v3 (`durationSec` из настроек вопроса, серверный `openedAt` ISO из payload `question.opened`):

- `remainingSec(durationSec: number | null, openedAt: string | null, nowMs: number): number | null` — `null` duration ИЛИ `null` openedAt → `null`; иначе `clamp(durationSec - floor((nowMs - Date.parse(openedAt))/1000), 0, durationSec)` — floor после деления (целые секунды), нижний clamp держит ноль без отрицательных, верхний — кейс «часы клиента впереди сервера» (openedAt в будущем → durationSec, не выше).
- `formatTimer(sec: number): string` — `m:ss` с ведущим нулём секунд (65 → `1:05`, 30 → `0:30`, 0 → `0:00`).
- `useQuestionTimer(durationSec, openedAt): number | null` — `setInterval` 1000 ms, пересчёт от `Date.now()`, cleanup на размонтировании/смене аргументов; без DOM-теста (паттерн репо: чистые функции тестируются, хук — typecheck). Потребителей (T7–T9) пока нет — по брифу это норма.

## TDD Evidence

**RED** (Step 1–2): спека `question-timer.spec.ts` написана до реализации со всеми кейсами брифа.

- Команда: `pnpm --filter @mymozhem/web test`
- Вывод: `Test Files  1 failed | 20 passed (21)` — ошибка импорта `./question-timer` (модуля нет), ожидаемый RED: тестируемый код ещё не существует.

**GREEN** (Step 3–4): реализация + хук.

- Команда: `pnpm --filter @mymozhem/web test`
- Вывод: `Test Files  21 passed (21)`, `Tests  132 passed (132)`.
- Команда: `pnpm --filter @mymozhem/web typecheck` — чисто (tsc --noEmit без ошибок).

## Files changed

- `apps/web/src/state/question-timer.ts` (new)
- `apps/web/src/state/question-timer.spec.ts` (new)

Commit: `b6c2a0a feat(web): question-timer — remainingSec/formatTimer/useQuestionTimer (тик 1 с, clamp 0..durationSec)`

## Self-review findings

Все кейсы Step 1 брифа присутствуют в спеке:

- без лимита (durationSec=null) → null ✓
- не открыт (openedAt=null) → null ✓
- ровно 30 → `formatTimer(30)` = `0:30` ✓
- стоит на нуле: `formatTimer(0)` = `0:00`, openedAt час назад → 0 (без отрицательных) ✓
- Review Focus 1: openedAt 20 с назад при 30 → 10; openedAt час назад → 0 ✓
- Review Focus 2: openedAt в будущем → durationSec (не выше) ✓
- `formatTimer(65)` → `1:05` ✓

Хук: interval 1000 ms с cleanup (`clearInterval`), возвращаемый тип `number | null` ✓. Новых зависимостей нет; `pnpm install` не запускался. Тест-аутпут чистый.

## Concerns

Нет. Мелкое наблюдение (не дефект): хук пересчитывает начальное состояние в `useEffect` даже когда аргументы `null` — сознательно, чтобы не стартовать interval и не оставлять стейлое значение при смене на null; тик «без лимита» не нужен.
