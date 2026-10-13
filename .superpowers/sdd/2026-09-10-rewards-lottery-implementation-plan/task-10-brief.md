### Task 10: app-quiz → manifestVersion 2 + эффекты начислений

**Files:**
- Modify: `packages/app-quiz/src/quiz-manifest.ts` (version 2, capabilities)
- Modify: `packages/app-quiz/src/quiz-handlers.ts` (возврат AppPublishResult; эффекты в closeQuestion)
- Test: `packages/app-quiz/src/quiz-manifest.contract.spec.ts` (version/capabilities), `packages/app-quiz/src/quiz-handlers.spec.ts` (форма возврата + эффекты)

**Interfaces:**
- Consumes: `AppPublishResult`, capability 'rewards' (Tasks 2-3); скоринг `Math.max(base − k·step, 0)` — существующий (quiz-handlers.ts:97-103).
- Produces: `QUIZ_MANIFEST_VERSION = 2`; `question.closed` несёт эффекты `{ kind: 'award.points', identityId, points, reason: 'quiz.round' }` на каждого ответившего с points > 0 — исполняет диспетчер (Task 7) в той же транзакции, что reveal-событие. Потребитель-связка: Task 11; приёмка: Task 13.

**REQ:** REQ-RWD-002a/b (начисления без приза), REQ-RT-004 (пин (appId, manifestVersion) — миграция контента не нужна, активных квиз-комнат нет), REQ-RWD-001 (capability).

- [ ] **Step 1: Failing tests**

`quiz-manifest.contract.spec.ts`: ожидания `QUIZ_MANIFEST_VERSION` → 2 и `manifest.capabilities` → `['rewards']` (поправить существующие ассерты/EXPECTED).

`quiz-handlers.spec.ts`:
1. Все существующие ожидания формы «массив коммитов» перевести на `{ commits, effects: [] }` (wrap ожиданий; closeQuestion/finishGame/submitAnswer).
2. Новый кейс в describe closeQuestion:

```typescript
    it('начисления: эффект award.points на каждого ответившего с points > 0, reason quiz.round', () => {
      // openState с двумя правильными ответами (P2 быстрее P1) и одним неверным;
      // scoring { base: 1000, step: 100 } → awarded P2=1000, P1=900.
      const result = handleQuizPublish(ctx({ state: openState(0, /* ответы */) }), 'question.closed', { questionIndex: 0 });
      expect(result.effects).toEqual([
        { kind: 'award.points', identityId: P2, points: 1000, reason: 'quiz.round' },
        { kind: 'award.points', identityId: P1, points: 900, reason: 'quiz.round' },
      ]);
      // Неверный ответ эффекта не даёт; reveal-коммит не изменился (awarded/totals как прежде).
      expect(result.commits.map((c) => c.shortName)).toEqual(['question.closed', 'question.revealed']);
    });

    it('clamp-ветка скоринга (points = 0) эффекта не порождает', () => {
      // scoring { base: 100, step: 100 }, три правильных ответа: 100, 0, 0 →
      // эффект только на первого (points > 0).
      // (Закрывает deferred-minor ф.2: clamp-ветка без отдельного теста.)
    });
```

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/app-quiz test`
Expected: FAIL (version/capabilities; форма возврата).

- [ ] **Step 3: Implement**

`quiz-manifest.ts`:

```typescript
export const QUIZ_MANIFEST_VERSION = 2;
// ...
  return defineApp({
    appId: QUIZ_APP_ID,
    manifestVersion: QUIZ_MANIFEST_VERSION,
    capabilities: ['rewards'], // фаза 3: начисления баллов эффектами (design 2026-09-10 §5)
    appSettings: quizSettingsSchema,
    events: { /* без изменений */ },
  });
```

`quiz-handlers.ts` (импорты += `type AppEffect`, `type AppPublishResult` из `@mymozhem/sdk`):
1. Сигнатура `handleQuizPublish(...): AppPublishResult`; каждая команда возвращает `{ commits: [...прежний массив...], effects: [] }`, кроме closeQuestion.
2. closeQuestion — эффекты из awarded (существующий расчёт скоринга не трогаем):

```typescript
  // Начисления rewards (design §5): reveal-событие и ledger-записи коммитятся
  // одной транзакцией с эффектами. Табло остаётся проекцией квиза; ledger —
  // платформенная запись. Дублирование осознанное; инвариант «менять вместе»:
  // изменение скоринга трогает обе записи; сходимость — e2e Task 13.
  const effects: AppEffect[] = awarded
    .filter((a) => a.points > 0) // clamp-ветка шкалы не порождает нулевых грантов
    .map((a) => ({ kind: 'award.points', identityId: a.actorId, points: a.points, reason: 'quiz.round' }));
  return {
    commits: [ /* прежняя пара question.closed + question.revealed */ ],
    effects,
  };
```

Идемпотентность: повторный `question.closed` гасится существующим гейтом «раунд уже закрыт» (ROUND_NOT_OPEN) до эффектов — новой логики не надо; `game.finished` эффектов не несёт (решение §0.8).

- [ ] **Step 4: Run — GREEN + e2e-регрессия квиза**

Run: `pnpm --filter @mymozhem/app-quiz test && pnpm build && pnpm --filter @mymozhem/server test -- quiz.e2e`
Expected: PASS. Внимание: quiz.e2e конфигурирует комнату через `QUIZ_MANIFEST_VERSION` — константа подхватит 2 автоматически; но **пока Task 11 не подключил rewards-исполнитель, e2e квиза с эффектами упадёт на CAPABILITY_UNAVAILABLE**. Поэтому порядок: Task 10 коммитит модуль, а quiz.e2e прогоняется после Task 11 (в его же батче). До Task 11 проверка — unit-тесты пакета. Если quiz.e2e в CI-прогоне батча D падает до Task 11 — это ожидаемое промежуточное состояние, НЕ мерджить батч на нём; задачи 10-11 атомарны для зелёного main.

- [ ] **Step 5: Commit**

```bash
git add packages/app-quiz
git commit -m "feat(app-quiz): manifestVersion 2 — capability rewards, начисления эффектами при question.closed

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

