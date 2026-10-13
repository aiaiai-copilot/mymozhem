### Task 13: quiz e2e — приёмка фазы 2

**Files:**
- Create: `apps/server/test/quiz.e2e-spec.ts`

**Interfaces:**
- Consumes: всё выше; харнесс `realtime.e2e-spec.ts` (createApp/connect/emitAck/waitEvent/seedIdentity, `app.get(RoomService)` и т.д.).

Содержание (каждый `it` — сценарий; общий `beforeAll`: testcontainers БД, app с overrides `APP_MANIFESTS=[quiz manifest]`, `APP_RUNTIME_MODULES=[createQuizRuntime()]`, `seedIdentity(ORG)`). Базовые helper'ы:

```typescript
// Комната квиза в ACTIVE (сервисный путь, прецедент realtime.e2e: configure обязателен
// до activate; HTTP-эндпоинта configure нет — срез его не добавляет, design §1).
async function activeQuizRoom(settings: QuizSettings): Promise<string> {
  const room = await roomService.create(ORG);
  await roomService.configure(room.id, { appId: QUIZ_APP_ID, manifestVersion: QUIZ_MANIFEST_VERSION, settings });
  await roomService.activate(room.id);
  return room.id;
}

const QUIZ_SETTINGS: QuizSettings = {
  questions: [
    { text: '2+2?', options: ['3', '4'] },
    { text: 'Столица Франции?', options: ['Лион', 'Париж'] },
  ],
  correctAnswers: [1, 1],
  minAnswerIntervalMs: 0,
  scoring: { base: 1000, step: 100 },
};

// Гость через HTTP (транспортный путь): POST /rooms/join → accessToken → connect.
async function joinGuest(roomCode: string, name: string, role?: 'spectator'): Promise<{ socket: ClientSocket; token: string }> {
  const res = await app.inject({
    method: 'POST', url: '/rooms/join',
    payload: { code: roomCode, displayName: name, ...(role ? { role } : {}) },
  });
  const { accessToken } = res.json() as { accessToken: string };
  return { socket: await connect(port, accessToken), token: accessToken };
}
```

Организатор на ws: токен через `app.get(TokenService).issueRegisteredTokens(ORG)` (прецедент realtime.e2e «путь развёрнут вручную»); `roomService.create(ORG)` требует REGISTERED-identity — `seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' })`.

Сценарии:

1. **Полная игра** (приёмочный сценарий): настройки `QUIZ_SETTINGS`, 2 гостя (P1, P2) + организатор на ws, все подписаны. Организатор `question.opened(0)` → оба отвечают: P1 верно (optionIndex 1), P2 неверно (0) → live `answer.accepted` у всех (public, без optionIndex) → `question.closed(0)` → live `question.revealed` с `correctIndex: 1` и `awarded: [{ P1, 1000 }]` → `question.opened(1)` → оба отвечают верно, P2 первым (упорядочить через await ack P2 до publish P1) → close → `question.revealed`: awarded=[{P2,1000},{P1,900}] → `game.finish` → `game.finished` standings: P1 total 1900 place 1, P2 total 1000 place 2. Гость, не отвечавший ни разу (P3), присутствует в standings с total 0 только если отвечал хоть раз — нет: standings строятся из totals редьюсера, P3 в них не попадает (зафиксировать это поведение в assert). Порядок live-событий у клиента совпадает с порядком в логе (`readRoomLog`).
2. **Чит-тест** (критерий выхода): в сценарии 1 до `question.revealed` — ни один кадр/ack/snapshot, полученный участником, не содержит значение correctIndex (проверка сериализацией: `JSON.stringify(frame)` не содержит `"correctIndex"`; snapshot.appSettings не содержит `correctAnswers`). Повторный `subscribe` (replay) после первого раунда: в snapshot есть `question.revealed` раунда 0 (раскрыт легально), нет `answer.submitted` (module-private) и нет `correctAnswers`. Организаторский snapshot тоже без `correctAnswers` (module-private не отдаётся никому).
3. **Late-join участника** в ACTIVE в середине раунда: snapshot содержит текущий открытый вопрос (public), участник отвечает успешно.
4. **Late-join зрителя**: join `role: 'spectator'` → subscribe ok, snapshot public; publish `answer.submitted` → ack `{ code: 'PUBLISH_FORBIDDEN' }`; в логе ничего не прибавилось.
5. **Анти-бот (REQ-RT-013)**: комната с `minAnswerIntervalMs: 60_000` → ответ сразу после открытия → `{ code: 'ANSWER_TOO_FAST' }`, в логе нет answer.submitted. Комната с `0` → ответ принят.
6. **Конкурентный double-answer одного участника**: два параллельных publish → ровно один `ok`, другой `ALREADY_ANSWERED`; `readRoomLog` — ровно один `quiz.answer.submitted` от этого actorId.
7. **Ролевые гейты**: участник publish `question.opened` → `PUBLISH_FORBIDDEN`; участник `game.finish` → `PUBLISH_FORBIDDEN`.
8. **Пересоздание проекции**: после раунда 0 `app.get(AppRuntimeService).invalidateProjection(roomId)` → следующий `answer.submitted` обрабатывается (replay восстановил состояние), очки в `question.revealed` сходятся с ожиданием (включают раунд 0).
9. **Запечатанная комната**: `RoomService.transition` в COMPLETED (как в существующих тестах) → publish → отказ (`ROOM_LOG_SEALED`).

- [ ] **Step 1: Failing e2e (скелет сценария 1)**

Run: `pnpm --filter @mymozhem/server test -- quiz`
Expected: FAIL (файла нет → после создания: зелёный прогон = критерий).

- [ ] **Step 2: Implement все сценарии; прогон до зелёного.** Ожидаемые красные точки: тайминги (использовать `waitEvent` до `emitAck`, как в realtime.e2e), standings при нулевых очках (гость без правильных ответов присутствует в standings с total 0 — включить в сценарий 1).

- [ ] **Step 3: Run — GREEN**

Run: `pnpm --filter @mymozhem/server test -- quiz`
Expected: 9/9 PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server
git commit -m "test(app-quiz): приёмочные e2e квиза — полная игра, чит-тест, анти-бот, гонки, SPECTATOR, replay (критерии фазы 2)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

