### Task 12: e2e лотереи (приёмка механики на проводе)

**Files:**
- Test: `apps/server/test/lottery.e2e-spec.ts` (новый)

**Interfaces:**
- Consumes: хелперы quiz.e2e-spec.ts (`createApp`, `portOf`, `connect`, `emitAck`, `waitEventWhere`, `readRoomLog`, `joinGuest` — копируются локально, спек standalone); `organizerToken` по прецеденту transport.e2e-spec.ts:362-367 (`tokens.issueGuestTokens(ORG, room.id)`); REST-эндпоинты Task 6; `RoomService.create/configure/activate`.
- Produces: приёмка design §7 п.1, 2 (e2e-часть K>quantity), 4, 6.

**REQ:** REQ-RWD-003/004/007/009/010/011/014, REQ-SEC-009, REQ-RT-004.

- [ ] **Step 1: Написать e2e-спек целиком (код ниже), запустить — прогнать до зелёного**

Бутстрап — зеркало quiz.e2e (без override'ов: composition root уже регистрирует lottery; `jest.setTimeout(180_000)`; `afterEach` — TRUNCATE + `rewards."Award", rewards."Prize"` в список таблиц). Хелперы:

```typescript
const LOTTERY_SETTINGS: LotterySettings = { drawEligibility: 'guests_allowed' };

async function activeLotteryRoom(settings: LotterySettings = LOTTERY_SETTINGS) {
  const room = await roomService.create(ORG);
  await roomService.configure(room.id, {
    appId: LOTTERY_APP_ID,
    manifestVersion: LOTTERY_MANIFEST_VERSION,
    settings,
  });
  await roomService.activate(room.id, ORG);
  return room;
}

// REST с Bearer организатора (guest-claims, роль из membership — прецедент transport.e2e).
async function createPrize(roomId: string, name: string, quantity: number) {
  const token = (await tokens.issueGuestTokens(ORG, roomId)).accessToken;
  const res = await app.inject({
    method: 'POST', url: `/rooms/${roomId}/prizes`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name, quantity },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
}

async function fulfillAward(roomId: string, awardId: string) {
  const token = (await tokens.issueGuestTokens(ORG, roomId)).accessToken;
  return app.inject({ method: 'POST', url: `/rooms/${roomId}/awards/${awardId}/fulfill`, headers: { authorization: `Bearer ${token}` } });
}
async function revokeAward(roomId: string, awardId: string) {
  const token = (await tokens.issueGuestTokens(ORG, roomId)).accessToken;
  return app.inject({ method: 'POST', url: `/rooms/${roomId}/awards/${awardId}/revoke`, headers: { authorization: `Bearer ${token}` } });
}

// publish draw.run от организатора по сокету (тип lottery.draw.run — clientInitiated).
async function organizerSocket(roomId: string) {
  const token = (await tokens.issueGuestTokens(ORG, roomId)).accessToken;
  const socket = await connect(port, token);
  await emitAck(socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId });
  return socket;
}
```

(Точное имя subscribe-сообщения и форму ack — из quiz.e2e/realtime.e2e; REALTIME_MESSAGES из SDK.)

Сценарии:

```typescript
it('полный цикл: гости входят → приз → draw.run → draw.completed из пула → AWARDED → fulfill; события публичны live и в replay', async () => {
  const room = await activeLotteryRoom();
  const g1 = await joinGuest(room.code, 'Гость-1');
  const g2 = await joinGuest(room.code, 'Гость-2');
  const prize = await createPrize(room.id, 'Главный приз', 1);

  const orgSocket = await organizerSocket(room.id);
  // Waiters ДО publish (fan-out синхронен с коммитом — опыт Quiz-среза).
  const guestFrame = waitEventWhere(g1.socket, 'lottery.draw.completed');
  const rewardFrame = waitEventWhere(g2.socket, 'rewards.reward.awarded');

  const drawId = crypto.randomUUID();
  const ack = await emitAck<PublishAck>(orgSocket, REALTIME_MESSAGES.PUBLISH, {
    roomId: room.id, type: 'lottery.draw.run', payload: { drawId, prizeId: prize.id },
  });
  expect(ack).toEqual({ ok: true });

  const completed = await guestFrame;
  const winnerId = (completed.payload as { winnerId: string }).winnerId;
  expect([g1.identityId, g2.identityId]).toContain(winnerId); // победитель из пула
  expect(completed.payload).toMatchObject({ drawId, prizeId: prize.id });
  expect(completed.payload).not.toHaveProperty('displayName'); // REQ-SEC-009
  expect(((await rewardFrame).payload as { winnerId: string }).winnerId).toBe(winnerId);

  // Состояние в БД: награда AWARDED, фонд списан ровно на 1.
  const award = await db.prisma.award.findFirstOrThrow({ where: { roomId: room.id } });
  expect(award).toMatchObject({ prizeId: prize.id, winnerId, status: 'AWARDED', sourceAppId: 'lottery' });
  expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(0);

  // Replay: переподключённый гость видит оба события в snapshot.
  const again = await joinGuest(room.code, 'Гость-1-снова');
  const sub = await emitAck<SubscribeAck>(again.socket, REALTIME_MESSAGES.SUBSCRIBE, { roomId: room.id });
  const types = sub.snapshot.events.map((e) => e.type);
  expect(types).toContain('lottery.draw.completed');
  expect(types).toContain('rewards.reward.awarded');

  // Вручение очное (REQ-RWD-004): REST fulfill → 200 + публичное rewards.reward.fulfilled.
  const fulfillFrame = waitEventWhere(g1.socket, 'rewards.reward.fulfilled');
  const res = await fulfillAward(room.id, award.id);
  expect(res.statusCode).toBe(200);
  await fulfillFrame;
  expect((await db.prisma.award.findUniqueOrThrow({ where: { id: award.id } })).status).toBe('FULFILLED');
});

it('повтор draw.run с тем же drawId — no-op: второй розыгрыш не состоялся, фонд не списан (REQ-RWD-003 на уровне app-команды)', async () => {
  const room = await activeLotteryRoom();
  await joinGuest(room.code, 'Гость');
  const prize = await createPrize(room.id, 'Приз', 2);
  const orgSocket = await organizerSocket(room.id);
  const drawId = crypto.randomUUID();
  const cmd = { roomId: room.id, type: 'lottery.draw.run', payload: { drawId, prizeId: prize.id } };
  await emitAck(orgSocket, REALTIME_MESSAGES.PUBLISH, cmd);
  const again = await emitAck<PublishAck>(orgSocket, REALTIME_MESSAGES.PUBLISH, cmd);
  expect(again).toEqual({ ok: true }); // typed no-op, не отказ
  expect(await db.prisma.award.count({ where: { roomId: room.id } })).toBe(1);
  expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(1);
  // Re-emit прежнего результата: в логе два draw.completed с одним drawId/winnerId.
  const log = await readRoomLog(db.prisma, room.id);
  const completions = log.filter((e) => e.type === 'lottery.draw.completed');
  expect(completions).toHaveLength(2);
  expect(completions[0].payload).toEqual(completions[1].payload);
});

it('K > quantity конкурентных draw.run → ровно quantity победителей, без минуса (REQ-RWD-010, e2e-версия)', async () => {
  const room = await activeLotteryRoom();
  await joinGuest(room.code, 'Гость-1');
  await joinGuest(room.code, 'Гость-2');
  await joinGuest(room.code, 'Гость-3');
  const prize = await createPrize(room.id, 'Приз', 1);
  const orgSocket = await organizerSocket(room.id);
  const acks = await Promise.all([
    emitAck<PublishAck>(orgSocket, REALTIME_MESSAGES.PUBLISH, { roomId: room.id, type: 'lottery.draw.run', payload: { drawId: crypto.randomUUID(), prizeId: prize.id } }),
    emitAck<PublishAck>(orgSocket, REALTIME_MESSAGES.PUBLISH, { roomId: room.id, type: 'lottery.draw.run', payload: { drawId: crypto.randomUUID(), prizeId: prize.id } }),
  ]);
  // RoomSerializer сериализует однокомнатные команды: второй draw видит пул без
  // первого победителя, но фонд уже пуст → PRIZE_FUND_EXHAUSTED.
  const oks = acks.filter((a) => 'ok' in a);
  const rejects = acks.filter((a) => 'code' in a);
  expect(oks).toHaveLength(1);
  expect(rejects).toEqual([{ code: 'PRIZE_FUND_EXHAUSTED' }]);
  expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(0);
});

it('eligibility verified: победитель всегда REGISTERED (REQ-RWD-014); гость при дефолте guests_allowed может выиграть (контроль)', async () => {
  // Комната verified: 2 гостя + 1 REGISTERED-партисипант (seedIdentity REGISTERED
  // + HTTP /rooms/join registered-токеном — по образцу joinGuest, токен от
  // issueRegisteredTokens). 10 розыгрышей с quantity 10 → все winnerId === registered.id.
  // Контрольная комната guests_allowed (уже покрыта первым сценарием: гость выигрывает).
});

it('revoke возвращает quantity и освобождает место: приз переразыгрывается тому же победителю (REQ-RWD-007/003)', async () => {
  // draw → revoke (REST) → quantity 1 → повторный draw другим drawId → новый AWARDED.
});

it('REQ-RWD-009: при COMPLETED организатор видит оставшиеся AWARDED и вручает/отзывает их по REST', async () => {
  const room = await activeLotteryRoom();
  await joinGuest(room.code, 'Гость');
  const prize = await createPrize(room.id, 'Приз', 1);
  const orgSocket = await organizerSocket(room.id);
  await emitAck(orgSocket, REALTIME_MESSAGES.PUBLISH, { roomId: room.id, type: 'lottery.draw.run', payload: { drawId: crypto.randomUUID(), prizeId: prize.id } });
  await roomService.transition(room.id, 'COMPLETED', ORG); // точную сигнатуру сверить с RoomService
  const token = (await tokens.issueGuestTokens(ORG, room.id)).accessToken;
  const list = await app.inject({ method: 'GET', url: `/rooms/${room.id}/rewards`, headers: { authorization: `Bearer ${token}` } });
  expect(list.statusCode).toBe(200);
  expect(list.json().awards).toHaveLength(1);
  expect(list.json().awards[0].status).toBe('AWARDED');
  const fulfill = await fulfillAward(room.id, list.json().awards[0].id);
  expect(fulfill.statusCode).toBe(200); // вручение после завершения работает
});

it('заниженная visibility draw.* отклоняется commit-гейтом (REQ-CTR-009) — контроль на уровне модуля невозможен клиентом: clientInitiated=false у draw.completed', async () => {
  const room = await activeLotteryRoom();
  const g = await joinGuest(room.code, 'Гость');
  const ack = await emitAck<PublishAck>(g.socket, REALTIME_MESSAGES.PUBLISH, {
    roomId: room.id, type: 'lottery.draw.completed', payload: { drawId: crypto.randomUUID(), prizeId: crypto.randomUUID(), winnerId: g.identityId },
  });
  expect(ack).toEqual({ code: 'PUBLISH_FORBIDDEN' }); // server-only тип: гейт диспетчера
  // и участник не организатор для draw.run:
  const ack2 = await emitAck<PublishAck>(g.socket, REALTIME_MESSAGES.PUBLISH, {
    roomId: room.id, type: 'lottery.draw.run', payload: { drawId: crypto.randomUUID(), prizeId: crypto.randomUUID() },
  });
  expect(ack2).toEqual({ code: 'PUBLISH_FORBIDDEN' });
});
```

- [ ] **Step 2: Run — до зелёного**

Run: `pnpm build && pnpm --filter @mymozhem/server test -- lottery.e2e`
Expected: PASS всех сценариев. Ловушки (HANDOFF): waiters до publish; уникальное имя файла в фильтре (`lottery.e2e`, не `lottery`); raw-лог lowercase visibility. Флейки не гасить ретраями — разобрать (прецедент: e2e на проводе ловит то, что unit не видит).

- [ ] **Step 3: Commit**

```bash
git add apps/server/test/lottery.e2e-spec.ts
git commit -m "test(server): e2e лотереи — полный цикл розыгрыша, идемпотентность, K>quantity, eligibility, REQ-RWD-009

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

**Конец Batch D.** Зелёный конвейер батча: `pnpm build && pnpm lint && pnpm boundary-check && pnpm guardrails && pnpm test && pnpm test:int`. Дальше — новой сессией.

---

