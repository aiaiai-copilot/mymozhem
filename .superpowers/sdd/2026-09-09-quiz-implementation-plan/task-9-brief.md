### Task 9: app-quiz — пакет и манифест

**Files:**
- Create: `packages/app-quiz/package.json`, `tsconfig.json`, `jest.config.js` (зеркало `packages/sdk/*`, имя `@mymozhem/app-quiz`, deps: `@mymozhem/sdk: workspace:*`, `zod: ^4.0.0`)
- Create: `packages/app-quiz/src/quiz-settings.ts`
- Create: `packages/app-quiz/src/quiz-events.ts`
- Create: `packages/app-quiz/src/quiz-manifest.ts`
- Create: `packages/app-quiz/src/quiz-manifest.contract.spec.ts`
- Create: `packages/app-quiz/src/index.ts`

**Interfaces:**
- Produces (потребляют Task 10–13):

```typescript
// quiz-settings.ts — appSettings (design §3 с правкой плана: видимость top-level,
// correctAnswers без аннотации → fail-safe module-private, REQ-CORE-008).
export const quizSettingsSchema = z.strictObject({
  questions: z
    .array(z.strictObject({ text: z.string().min(1), options: z.array(z.string().min(1)).min(2) }))
    .min(1)
    .meta({ 'x-visibility': 'public' }),
  correctAnswers: z.array(z.number().int().min(0)),
  minAnswerIntervalMs: z.number().int().min(0).meta({ 'x-visibility': 'public' }),
  scoring: z
    .strictObject({ base: z.number().int().positive(), step: z.number().int().min(0) })
    .meta({ 'x-visibility': 'public' }),
});
export type QuizSettings = z.infer<typeof quizSettingsSchema>;

// quiz-events.ts — payload-схемы (источник типов для handler'ов и манифеста).
export const questionOpenedPayload = z.strictObject({ questionIndex: z.number().int().min(0) });
export const answerSubmittedPayload = z.strictObject({
  questionIndex: z.number().int().min(0),
  optionIndex: z.number().int().min(0),
});
export const questionClosedPayload = z.strictObject({ questionIndex: z.number().int().min(0) });
export const finishGamePayload = z.strictObject({});
export const answerAcceptedPayload = z.strictObject({
  questionIndex: z.number().int().min(0),
  actorId: z.uuid(),
});
export const scoreEntryPayload = z.strictObject({ actorId: z.uuid(), total: z.number().int() });
export const questionRevealedPayload = z.strictObject({
  questionIndex: z.number().int().min(0),
  // Опционально: отсутствует, когда у вопроса не сконфигурирован правильный ответ
  // (correctAnswers[questionIndex] === undefined) — «нет правильного» не выражается
  // sentinel-значением, поле просто опущено.
  correctIndex: z.number().int().min(0).optional(),
  awarded: z.array(z.strictObject({ actorId: z.uuid(), points: z.number().int().min(0) })),
  totals: z.array(scoreEntryPayload),
});
export const gameFinishedPayload = z.strictObject({
  standings: z.array(scoreEntryPayload.extend({ place: z.number().int().min(1) })),
});

// quiz-manifest.ts
export const QUIZ_APP_ID = 'quiz';
export const QUIZ_MANIFEST_VERSION = 1;
export function buildQuizManifest(): AppManifest {
  return defineApp({
    appId: QUIZ_APP_ID,
    manifestVersion: QUIZ_MANIFEST_VERSION,
    appSettings: quizSettingsSchema,
    events: {
      'question.opened': { schema: questionOpenedPayload, visibility: 'public', clientInitiated: true },
      'answer.submitted': { schema: answerSubmittedPayload, visibility: 'module-private', clientInitiated: true },
      'question.closed': { schema: questionClosedPayload, visibility: 'public', clientInitiated: true },
      'game.finish': { schema: finishGamePayload, visibility: 'public', clientInitiated: true },
      'answer.accepted': { schema: answerAcceptedPayload, visibility: 'public', clientInitiated: false },
      'question.revealed': { schema: questionRevealedPayload, visibility: 'public', clientInitiated: false },
      'game.finished': { schema: gameFinishedPayload, visibility: 'public', clientInitiated: false },
    },
  });
}
```

**REQ:** REQ-CTR-008/009 (регистрация схем + ceilings), REQ-CORE-008 (correctAnswers module-private), REQ-CTR-005 (контрактные тесты манифеста).

- [ ] **Step 1: Failing contract test**

`quiz-manifest.contract.spec.ts`:
1. `buildQuizManifest()` проходит `appManifestSchema` и содержит все 7 типов с ожидаемыми `visibility`/`clientInitiated` (табличный assert).
2. Зарегистрированная JSON Schema appSettings (через Ajv2020, как ядро: `new Ajv2020({ allErrors: true, strict: false })`) — валидный снапshot настроек проходит; невалидные (пустой questions, minAnswerIntervalMs < 0, лишний ключ, options из одного элемента) отклоняются.
3. JSON Schema событий: валидный/невалидный payload каждого типа (например `answer.submitted` без `optionIndex` отклоняется, с строковым `questionIndex` отклоняется).
4. Видимость `correctAnswers`: `readPropertyVisibility(manifest.appSettings, 'correctAnswers') === 'module-private'` (fail-safe без аннотации), `questions/minAnswerIntervalMs/scoring === 'public'`.

- [ ] **Step 2: Run — RED**

Run: `pnpm install && pnpm --filter @mymozhem/app-quiz test`
Expected: FAIL (исходников нет).

- [ ] **Step 3: Implement** — файлы выше; `index.ts`: `export * from './quiz-settings'; export * from './quiz-events'; export * from './quiz-manifest';`

- [ ] **Step 4: Run — GREEN + boundary**

Run: `pnpm --filter @mymozhem/app-quiz test && pnpm boundary-check`
Expected: PASS; boundary-check зелёный (app-quiz импортирует только sdk/zod).

- [ ] **Step 5: Commit**

```bash
git add packages/app-quiz pnpm-lock.yaml
git commit -m "feat(app-quiz): пакет квиза — манифест, appSettings (correctAnswers module-private), схемы 7 типов событий

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

