# Task 10 — отчёт: app-quiz → manifestVersion 2 + эффекты начислений

**Статус:** DONE
**Коммит:** `e8f32b8` — `feat(app-quiz): manifestVersion 2 — capability rewards, начисления эффектами при question.closed`

## Что сделано

### `packages/app-quiz/src/quiz-manifest.ts`
- `QUIZ_MANIFEST_VERSION` = 1 → **2**.
- В `defineApp` добавлено `capabilities: ['rewards']` с комментарием (фаза 3, design 2026-09-10 §5).
- События манифеста не тронуты (REQ-RT-004: миграция контента не нужна, активных квиз-комнат нет).

### `packages/app-quiz/src/quiz-handlers.ts`
- Сигнатура `handleQuizPublish` (и всех командных функций): `AppCommit[]` → `AppPublishResult`.
- openQuestion / submitAnswer / finishGame возвращают `{ commits: [...прежний массив...], effects: [] }`; у finishGame комментарий «game.finished эффектов не несёт (решение §0.8)».
- closeQuestion: скоринг (`Math.max(base − k·step, 0)`) не изменён; добавлено отображение awarded → effects точно по брифу:
  ```typescript
  const effects: AppEffect[] = awarded
    .filter((a) => a.points > 0) // clamp-ветка шкалы не порождает нулевых грантов
    .map((a) => ({ kind: 'award.points', identityId: a.actorId, points: a.points, reason: 'quiz.round' }));
  ```
  с комментарием о дублировании табло/ledger и инварианте «менять вместе» (сходимость — e2e Task 13).
- Идемпотентность: новой логики не добавлено — повторный `question.closed` гасится существующим гейтом ROUND_NOT_OPEN до вычисления эффектов.
- Импорты: `type AppEffect`, `type AppPublishResult` из `@mymozhem/sdk`; неиспользуемый `type AppCommit` убран. Boundary соблюдён — импорты только из `@mymozhem/sdk` + локальные файлы.

### Тесты
- `quiz-manifest.contract.spec.ts`: новый тест «pins manifestVersion 2 with the rewards capability» (`QUIZ_MANIFEST_VERSION === 2`, `manifest.capabilities === ['rewards']`).
- `quiz-handlers.spec.ts`: все ожидания формы «массив коммитов» переведены на `{ commits, effects: [] }` (question.opened, answer.submitted ×4, question.closed ×3, game.finish ×2, dispatch через runtime). Убраны касты `as AppCommit[]` и импорт типа.
- Новые кейсы в describe question.closed:
  1. «начисления: эффект award.points на каждого ответившего с points > 0, reason quiz.round» — P2 быстрее P1 (scoring 1000/100) → эффекты `[{P2, 1000}, {P1, 900}]`; неверный ответ эффекта не даёт; reveal-коммит не изменён (`shortName`s и `awarded` pinned).
  2. «clamp-ветка скоринга (points = 0) эффекта не порождает» — scoring 100/100, три правильных ответа → awarded 100/0/0, эффект только на первого; нулевые начисления остаются в reveal, но не в ledger. (Закрывает deferred-minor ф.2.)
- В тест «no configured correct answer» добавлен ассерт `effects: []`.

## RED-evidence (Step 2, до реализации)

Команда: `pnpm --filter @mymozhem/app-quiz test`

```
FAIL src/quiz-handlers.spec.ts
  ● Test suite failed to run
    src/quiz-handlers.spec.ts:175:19 - error TS2339: Property 'commits' does not exist on type
    '{ shortName: string; payload: ...; visibility: ...; actor: ...; }[]'.
    ... (аналогичные TS2339 на всех новых обращениях result.commits / result.effects — 20+ ошибок)

FAIL src/quiz-manifest.contract.spec.ts
  ● quiz manifest › pins manifestVersion 2 with the rewards capability
    Expected: 2
    Received: 1
    at Object.<anonymous> (src/quiz-manifest.contract.spec.ts:43:35)

Test Suites: 2 failed, 1 passed, 3 total
Tests:       1 failed, 52 passed, 53 total
```

## GREEN-evidence (Step 4, после реализации)

Команда: `pnpm --filter @mymozhem/app-quiz test`

```
PASS src/quiz-state.spec.ts
PASS src/quiz-handlers.spec.ts
PASS src/quiz-manifest.contract.spec.ts
Test Suites: 3 passed, 3 total
Tests:       86 passed, 86 total
```

Команда: `pnpm build`

```
Tasks:    5 successful, 5 total  (sdk, app-quiz, app-lottery, core, server)
```

## Отклонения от брифа

1. **quiz.e2e не запускался** — бриф Step 4 сам предписывает отложить e2e до Task 11 (CAPABILITY_UNAVAILABLE до подключения rewards-исполнителя), а промпт явно запрещает `pnpm --filter @mymozhem/server test`. Проверка ограничена unit-тестами пакета + `pnpm build`.
2. Мелкое: в новых тестах добавлены ассерты на неизменность `awarded` в reveal-коммите (п.1) и на `effects: []` в кейсе без correctIndex — чуть шире буквы брифа, в его духе («reveal-коммит не изменился»).

## Замечания

- Ajv-стектрейс в выводе `quiz-manifest.contract.spec.ts` — console-шум внутри проходящего сьюта (присутствовал и в RED-прогоне, где падал ровно 1 тест из 53); на результат не влияет, pre-existing.
- Промежуточное состояние: квиз объявляет capability `rewards`, но исполнитель эффектов подключается в Task 11 — до него quiz.e2e ожидаемо падает; задачи 10–11 атомарны для зелёного main (по брифу Step 4).

## Self-review

- Значения из брифа воспроизведены дословно: `QUIZ_MANIFEST_VERSION = 2`, `capabilities: ['rewards']`, reason `'quiz.round'`, фильтр `points > 0`, порядок эффектов = порядок awarded (seq-ранжирование).
- Скоринг и reveal-payload не изменены (проверено сохранёнными ассертами awarded/totals/correctIndex).
- Сообщение коммита — дословно по Step 5, включая `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Коммит содержит только `packages/app-quiz` (4 файла: manifest, handlers, 2 spec-файла).
- REQ-покрытие: REQ-RWD-002a/b (эффекты начислений без приза, clamp-ветка без нулевых грантов), REQ-RT-004 (пин (appId, manifestVersion)=2), REQ-RWD-001 (capability rewards в манифесте).
