### Task 13: e2e квиз-начисления + сверка критериев выхода фазы 3

**Files:**
- Test: `apps/server/test/quiz-points.e2e-spec.ts` (новый; НЕ править quiz.e2e — он остаётся приёмкой ф.2 на manifestVersion 2)
- Modify: `HANDOFF.md` (состояние фазы 3) — в конце батча E

**Interfaces:**
- Consumes: хелперы quiz.e2e (копия), `db.prisma.pointsGrant`, `runtime: AppRuntimeService` (проекция табло — через replay лога, как в quiz.e2e).
- Produces: приёмка design §7 п.8 + итоговая сверка §7 целиком.

**REQ:** REQ-RWD-002b (начисления без приза), сходимость «табло квиза ≡ ledger rewards» (design §5), REQ-SEC-009.

- [ ] **Step 1: Написать e2e-спек, прогнать до зелёного**

`quiz-points.e2e-spec.ts` (бутстрап — зеркало quiz.e2e):

```typescript
it('после reveal ledger-записи появляются и сходятся с табло; повторный закрытый раунд не дублирует начисления', async () => {
  // Комната квиза (QUIZ_SETTINGS — 2 вопроса, scoring { base: 1000, step: 100 }),
  // два гостя отвечают на вопрос 0 правильно (P2 быстрее P1: 1000 и 900),
  // вопрос 1 — только P1 (1000). question.closed на каждый раунд от организатора.
  const room = await activeQuizRoom(QUIZ_SETTINGS);
  // ... сценарий ответов по образцу quiz.e2e (waiters до publish) ...

  const grants = await db.prisma.pointsGrant.findMany({ where: { roomId: room.id }, orderBy: { createdAt: 'asc' } });
  expect(grants).toHaveLength(3);
  expect(grants.every((g) => g.reason === 'quiz.round' && g.sourceAppId === 'quiz')).toBe(true);

  // Сходимость: суммы ledger ≡ суммы awarded из reveal-событий (табло строится из них).
  const log = await readRoomLog(db.prisma, room.id);
  const awarded = log
    .filter((e) => e.type === 'quiz.question.revealed')
    .flatMap((e) => (e.payload as { awarded: { actorId: string; points: number }[] }).awarded);
  const sumBy = (rows: { id: string; points: number }[]) =>
    rows.reduce((m, r) => m.set(r.id, (m.get(r.id) ?? 0) + r.points), new Map<string, number>());
  const ledgerTotals = new Map<string, number>();
  for (const g of grants) ledgerTotals.set(g.identityId, (ledgerTotals.get(g.identityId) ?? 0) + g.points);
  const boardTotals = sumBy(awarded.map((a) => ({ id: a.actorId, points: a.points })));
  expect(Object.fromEntries(ledgerTotals)).toEqual(Object.fromEntries(boardTotals));
  expect(ledgerTotals.get(p1.identityId)).toBe(1900);
  expect(ledgerTotals.get(p2.identityId)).toBe(1000);

  // Идемпотентность: повторный question.closed того же раунда → ROUND_NOT_OPEN, грантов не добавилось.
  // (ack с кодом; grants.length остаётся 3.)

  // PII: payload'ы reveal и rewards-событий не несут имён (REQ-SEC-009) — awarded несут actorId.
  for (const e of log) {
    expect(JSON.stringify(e.payload)).not.toContain('Гость');
  }
});

it('квиз v1-пин не исполняет эффекты: комната quiz@1 получает MODULE_UNAVAILABLE на publish (нет модуля под пин — пин работает, REQ-RT-004)', async () => {
  // configure с manifestVersion: 1 + activate → publish question.opened →
  // ack { code: 'MODULE_UNAVAILABLE' } (в реестре только quiz@2).
  // Фиксирует: старая версия манифеста не получает новое поведение «внаглую».
});
```

- [ ] **Step 2: Run — до зелёного**

Run: `pnpm build && pnpm --filter @mymozhem/server test -- quiz-points.e2e`
Expected: PASS.

- [ ] **Step 3: Сверка критериев выхода фазы 3 (design §7 ↔ тесты)**

Прогнать полный конвейер: `pnpm build && pnpm lint && pnpm boundary-check && pnpm guardrails && pnpm test && pnpm test:int && pnpm --filter @mymozhem/server test`. Затем заполнить таблицу сверки (в коммит-сообщение или отдельный `docs/sessions/2026-09-XX-phase-3-exit-audit.md` — по образцу exit-аудитов ф.1/ф.2; отдельным документом, если владелец запросит формальную сверку):

| Критерий (design §7) | Покрытие |
|---|---|
| 1. e2e лотереи (полный цикл, REST, публичность live+replay) | lottery.e2e «полный цикл» |
| 2. Конкурентный дубль; K>quantity (int + e2e); повторное вручение; двойной отзыв; revoke освобождает/fulfill нет | rewards.int-spec (5 кейсов) + lottery.e2e «K > quantity» + rewards-schema.int-spec |
| 3. Непредсказуемость: randomInt над node:crypto, границы, sanity распределения | app-runtime.int-spec «ctx.randomInt»; конструкция (единственный источник) + lint-запрет Math.random (Task 11) |
| 4. Eligibility verified/guests_allowed | lottery-handlers.spec + lottery.e2e «eligibility» |
| 5. Приостановка TTL (REQ-RWD-013) | guest-sweep.int-spec (4 кейса) |
| 6. REQ-RWD-009 (AWARDED при COMPLETED, fulfill/revoke после завершения) | lottery.e2e «REQ-RWD-009» + rewards.controller.int-spec |
| 7. Границы и контракт: boundary, capability-гейт, visibility ceiling, PII, автотест индекса | guardrails/boundary (Task 11), app-runtime.int-spec «эффекты без capability», lottery.e2e «заниженная visibility», quiz-points.e2e PII-ассерт, rewards-schema.int-spec |
| 8. Квиз-начисления: ledger сходится с табло; v1-гейт | quiz-points.e2e (оба кейса) |

Несоответствий быть не должно; любое «покрыто косвенно» — поднять владельцу, не замалчивать.

- [ ] **Step 4: Финальное двухстадийное ревью среза**

superpowers:requesting-code-review по диапазону коммитов батчей A–E: первая стадия — spec-compliance против REQ-списка Global Constraints + design §1; вторая — code quality. Findings триажить по прецеденту ф.2 (гейтящие — фикс в этом батче, миноры — deferred с записью в HANDOFF).

- [ ] **Step 5: Commit + HANDOFF**

```bash
git add apps/server/test/quiz-points.e2e-spec.ts docs/sessions
git commit -m "test(server): e2e квиз-начислений — сходимость ledger↔табло; сверка критериев выхода фазы 3

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

Обновить `HANDOFF.md` (навык handoff): фаза 3 реализована, остаточные риски, follow-up пакеты (в т.ч. перенести закрытые: ajv-formats, invalid-uuid литералы, clamp-тест), push — решение владельца.

---

## Self-review плана (пройден при написании 2026-09-10)

**Покрытие дизайна:**
- §1 REQ-список — все REQ распределены по задачам (см. Global Constraints и REQ-теги задач); REQ-RWD-006/008/012 явно вне объёма (отложены ADR-007/010).
- §2 архитектура — Tasks 3 (эффекты/хост-примитивы/capability), 5-6 (rewards + REST), 7 (диспетчер), 11 (boundary/DI).
- §3 модель данных — Task 4 (+ автотесты REQ-DEV-006).
- §4 лотерея — Task 9 (+ e2e Task 12).
- §5 квиз-начисления + свип — Tasks 10, 8 (+ e2e Task 13).
- §6 сборка по пакетам — sdk (T2-3), core (T1, T4-8), app-lottery (T9), app-quiz (T10), apps/server (T11).
- §7 тестирование — Task 13 (таблица сверки).
- §8 риски — AJV uuid (T1, решено владельцем), lint Math.random (T11, решено), дублирование счёта (T13 сходимость), латентность drawPool (принято дизайном).

**Интерпретации, зафиксированные планом (для ревью владельцем):**
1. Повтор `drawId` — no-op с **re-emit** прежнего `draw.completed` (без эффекта): «с прежним результатом» дизайна §4 на publish-канале без result-поля реализуется повторной эмиссией; редьюсер дедуплицирует.
2. `AwardStatus` в БД — uppercase БЕЗ `@map` (прецедент MemberRole), под дословный SQL частичного индекса дизайна §3.
3. Порядок в awardPrize: insert Award → декремент (no-op по индексу не списывает фонд; отказ декремента откатывает insert).
4. Cross-переход автомата (fulfill после revoke / revoke после fulfill) — `REWARD_ALREADY_RESOLVED` (409); одноимённый повтор — no-op 200 с текущим состоянием.
5. `award.points` события в логе НЕ порождает (ledger — платформенная запись; публичность начислений уже несёт `question.revealed`).
6. `createPrize` — только DRAFT/ACTIVE (wire `ROOM_NOT_ACTIVE`, 409); fulfill/revoke/list — без статусного гейта (REQ-RWD-009), кроме удалённой комнаты.
7. `ROOM_NOT_ACTIVE` добавлен в `CONTRACT_ERROR_CODES` (вывод на wire существующего внутреннего кода realtime).
8. Гард-чек приостановки — внутри транзакции свипа (окно гонки «награда создана между чтением кандидатов и анонимизацией» закрыто).
9. `IdentitySweepModule` не импортируется тестами — расписание в тестах не стартует; логика свипа покрыта прямым вызовом.
10. Tasks 10-11 атомарны для зелёного main: quiz@2 с эффектами требует подключённого исполнителя (CAPABILITY_UNAVAILABLE до Task 11) — батч D не мерджить между ними.

**Плейсхолдеры:** точечные «сверить с файлом» — только там, где план ссылается на существующие хелперы/сигнатуры, читаемые исполнителем из кода (точная форма seed-хелперов, имена REALTIME_MESSAGES, сигнатура RoomService.transition). Весь новый код дан дословно.
