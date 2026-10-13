# Task 10 review: app-quiz — состояние и редьюсер

**Reviewed range:** `5cf1df7..27c63f3` (1 коммит, 3 файла, +230)
**Inputs:** task-10-brief.md, task-10-report.md, review-5cf1df7..27c63f3.diff; дополнительно сверены `packages/sdk/src/app-runtime/app-log-event.ts` и `packages/app-quiz/src/quiz-events.ts` (неизменённый код, на который опирается дифф), и полное сообщение коммита через `git log`.

## Spec compliance: ✅

Проверка брифа строка за строкой:

- **Файлы:** `quiz-state.ts` и `quiz-state.spec.ts` созданы. `index.ts` +1 строка экспорта — оправдано брифом («Produces (потребляет Task 11)»: без реэкспорта Task 11 не сможет импортировать из корня пакета), не scope creep.
- **Интерфейс `QuizState`:** совпадает с брифом дословно (все 6 полей, readonly, комментарии про `openedAt` и key=actorId на месте). Сигнатуры `initialQuizState()` / `reduceQuiz(state, event)` — как в брифе.
- **Семантика reduce, по веткам:**
  - `question.opened` → `currentQuestion/accepting/openedAt/answers:{}` — точно по брифу, `openedAt` из `event.recordedAt` (серверное время) ✓
  - `answer.submitted` → `answers[actorId] = {optionIndex, seq: event.seq}` ✓; дополнительная защитная ветка `actorId === null → no-op` не противоречит брифу (бриф: «actorId не-null по контракту команды») — редьюсер не падает, поведение в недостижимой ветке безопасное
  - `question.closed` → `accepting: false` ✓
  - `question.revealed` → `totals += awarded` ✓; игнорирование поля `totals` payload'а согласуется с брифом (бриф требует только суммирование awarded; derived-not-trusted — из context note брифа, зафиксировано тестом)
  - `game.finished` → `finished: true` ✓
  - `game.finish`, `answer.accepted`, неизвестные → default-ветка, state без изменений (та же ссылка) ✓
- **Тесты брифа (Step 1):** все 8 требуемых сценариев присутствуют. Иммутабельность проверена настоящим образом: JSON-снапшот исходного state до вызова + `expect(state).toEqual(snapshot)` после двух разных событий + `next !== state` + новые ссылки `answers`/`totals` — это фактическая проверка отсутствия мутации, а не формальность.
- **Дополнительные тесты** (`question.closed` не трогает answers; no-op для `game.finish`/`answer.accepted` с `toBe`) фиксируют binding-семантику брифа; раскрыты в отчёте исполнителя. Не scope creep.
- **Глобальные ограничения:** импорты — только `@mymozhem/sdk` (type-only `AppLogEvent`), `zod` (type-only), локальный `quiz-events`; `@mymozhem/core` не импортируется; таблиц/состояния процесса нет — чистая проекция (ADR-005, REQ-CORE-004). Unit-тесты в `*.spec.ts`. Коммит conventional, по-русски, trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>` на месте (проверено `git log -1 --format='%B'`). Push не выполнялся (по отчёту).
- **Ruling нейминга батча 3:** типы событий dotted-lowercase во всех case-метках и тестах ✓; TS-идентификаторы camelCase ✓.

## ⚠️ Cannot verify from diff

- Фактический прогон тестов/gate'ов (jest, typecheck, lint, boundary-check) — принят по свидетельству отчёта (11/11, 52/52 по пакету, boundary 505 modules clean); перезапуск вне мандата ревью.
- Экспорт `AppLogEvent` из корня `@mymozhem/sdk` — виден по успешному typecheck в отчёте; сам barrel SDK вне диффа (форма интерфейса сверена с `app-log-event.ts`: 5 полей, тест-хелпер их воспроизводит точно).

## Strengths

- Семантика каждой ветки сверена с брифом и совпадает без отклонений; default-ветка возвращает ту же ссылку — дёшево и запинено тестом.
- Тест `question.revealed` с намеренно «врущим» `totals: 9999` в payload доказывает derived-перестройку, а не копирование — это самое тонкое место брифа.
- Тест-хелпер `event()` строит валидный `AppLogEvent` целиком (все 5 полей интерфейса), без `as any`.
- Type-only импорты (`import type { z }`, `import type { AppLogEvent }`) — zod не попадёт в рантайм-граф app-модуля.

## Issues

**Critical:** нет.

**Important:** нет.

**Minor:**

1. `quiz-state.spec.ts:120-127` — фикстура раунда 2 `question.revealed` опускает `correctIndex`, обязательный по `questionRevealedPayload` (strictObject). Безвредно (payload в тесте типизирован как `Record<string, unknown>`, редьюсер поле не читает, валидация — забота реестра), но фикстура формально расходится со схемой; при будущем рефакторинге хелпера на строгую типизацию всплывёт. Не блокирует.
2. `quiz-state.ts:37` / семантика: `answer.submitted` записывается редьюсером даже когда `accepting === false` (после `question.closed`). Полностью соответствует брифу (бриф предписывает безусловную запись; гейтинг поздних ответов — забота handler'а Task 11), отмечено как осознанная точка, не дефект.

## Verdicts

- **Spec compliance: ✅ Approved** — все требования брифа реализованы, лишнего нет; заявленные в отчёте дополнения (no-op тесты, экспорт из index) подтверждены как оправданные.
- **Code quality: Approved** — YAGNI соблюдён, тесты осмысленные, иммутабельность проверена реально, dead code и magic values отсутствуют, нейминг по ruling батча 3, коммит с trailer. Два minor-замечания носят информационный характер.
