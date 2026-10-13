# Task 12 report: e2e лотереи (apps/server/test/lottery.e2e-spec.ts)

**Status:** DONE. Commit `f5a74e2` (message verbatim из brief Step 3).
**Tests:** `pnpm build && pnpm --filter @mymozhem/server test -- lottery.e2e` — 7/7 PASS, три прогона подряд зелёные (6.4s / 4.6s / 4.6s), флейков не обнаружено. ESLint по файлу чист.

## Сценарии (все реализованы, все зелёные)

1. **Полный цикл**: 2 гостя (HTTP join → ws) → приз quantity 1 → draw.run от организатора → `lottery.draw.completed` live (победитель из пула, payload без displayName — REQ-SEC-009) → `rewards.reward.awarded` live с тем же winnerId → БД: Award AWARDED (sourceAppId 'lottery'), quantity 1→0 → replay: новый гость видит оба события в snapshot → REST fulfill → 200 + live `rewards.reward.fulfilled` + статус FULFILLED. (REQ-RWD-004, REQ-RT-004).
2. **Идемпотентность drawId** (REQ-RWD-003 app-уровень): повтор с тем же drawId → ack `{ok:true}` (типизированный no-op), award count = 1, quantity 2→1 (не списан вторично), в логе два `draw.completed` с идентичным payload (re-emit самолечения).
3. **K>quantity конкуренция** (REQ-RWD-010): 2 параллельных draw.run на одном сокете, prize quantity 1 → ровно один `{ok:true}`, второй `{code:'PRIZE_FUND_EXHAUSTED'}`, quantity 0 (без минуса), award count = 1. RoomSerializer сериализует; отказ декремента откатывает всю транзакцию второго розыгрыша.
4. **Eligibility verified** (REQ-RWD-014) — по рулингу D-pre.2: verified-комната, 2 гостя + 1 REGISTERED-партисипант, один розыгрыш quantity 1 → winnerId === REG детерминированно (payload кадра и строка Award). Контроль guests_allowed — сценарий 1 (гость выигрывает).
5. **Revoke** (REQ-RWD-007): draw → revoke (REST 200, статус REVOKED, live `rewards.reward.revoked`, quantity 0→1) → повторный revoke (200, no-op, quantity не возвращается дважды) → повторный draw новым drawId → новый AWARDED, quantity снова 0; в логе 1 revoked + 2 awarded.
6. **REQ-RWD-009**: после `roomService.complete` организатор GET /rooms/:id/rewards → 200, 1 награда AWARDED; fulfill → 200, FULFILLED. (Rewards-события коммитятся статическим путём без ACTIVE-гейта — подтверждено на проводе.)
7. **Publish-гейты** (REQ-CTR-009 по смыслу): гость publish `lottery.draw.completed` → `{code:'PUBLISH_FORBIDDEN'}` (clientInitiated=false, гейт диспетчера до модуля); гость publish `lottery.draw.run` → `{code:'PUBLISH_FORBIDDEN'}` (отказ модуля по роли).

## Отклонения от sketch'ей brief (с причинами)

1. **Сценарий 4 — по рулингу D-pre.2** (уже санкционировано): один розыгрыш вместо «10 draws quantity 10»; winner-exclusion прежних победителей приза (lottery-handlers.ts:49-56) делал sketch невозможным (DRAW_POOL_EMPTY на повторах).
2. **Сценарий 4 — посадка REGISTERED-партисипанта на уровне БД, не HTTP.** Рулинг 2 предполагал «registered participant joins via HTTP POST /rooms/join with that token» — это фактически невозможно: `JoinController.join` (packages/core/src/transport/join.controller.ts:21-32) не читает Authorization и ВСЕГДА создаёт нового guest (`membership.join` → `identity.createGuest`). HTTP-входа для REGISTERED в MVP не существует. Вместо этого: `seedIdentity(REG, kind REGISTERED)` + `db.prisma.membership.create({role:'PARTICIPANT'})`. Это честная посадка: пул розыгрыша читается диспетчером из membership-таблицы (`listActiveParticipantPool`, app-runtime.service.ts:127-129) в момент команды, так что e2e проверяет именно продуктовый путь выбора победителя. Заметка владельцу: если HTTP registered-join запланирован — это шов, которого пока нет.
3. **Сценарий 5 — поправка того же класса, что рулинг D-pre.2 (winner-exclusion), но НЕ покрытая буквой рулинга — требует подтверждения владельца.** Sketch brief гласил «приз переразыгрывается ТОМУ ЖЕ победителю». Реализация: `state.draws` (редьюсер лотереи) не забывает draw.completed даже после revoke (revoke — событие rewards-контура, редьюсер лотереи его не видит), поэтому прежний победитель навсегда вне пула повторных розыгрышей этого приза. «Тот же победитель» недостижим ни в одной конфигурации пула. Сценарий переписан: пул из 2 гостей, повторный розыгрыш детерминированно уходит ДРУГОМУ участнику; REQ-RWD-007 (возврат quantity ровно один раз, новый AWARDED) проверен полностью. **Побочное наблюдение:** DB-уровень (частичный индекс `WHERE status IN ('AWARDED','FULFILLED')` — re-award того же победителя после REVOKE разрешён) и handler-уровень (исключение по state.draws — не разрешён) расходятся в семантике; угол REQ-RWD-003 «partial index как страховка re-award после revoke» через handler недостижим. Возможный кандидат на продуктовое решение (revoke должен освобождать победителя для переразыгрыша?); зафиксировано здесь, не изменено.
4. **Publish-body без roomId.** В sketch'ах brief publish payload включал `roomId`; `publishRequestSchema` — strictObject `{type, payload}`, roomId берётся из подписки (realtime.gateway.ts:195-196). Использована форма quiz.e2e (`{type, payload}`) — иначе REQUEST_INVALID.
5. **Явные subscribe всем сокетам до waiters.** Sketch сценария 1 навешивал waiters на неподписанные сокеты гостей — live-кадры доставляются только подписчикам канала комнаты; добавлены subscribe (прецедент quiz.e2e).
6. **`roomService.complete(room.id, ORG)`** вместо sketch `transition(...)` — сигнатура сверена с RoomService (complete — обёртка transition, room.service.ts:215).
7. **afterEach TRUNCATE** расширен ровно как велено: `identity."Session", membership."Membership", rewards."Award", rewards."Prize", room."Room" CASCADE` (CASCADE покрывает realtime."LogEvent" и rewards."PointsGrant").

## Хелперы

Скопированы локально из quiz.e2e (спек standalone, санкционированное отклонение Quiz-среза): `createApp`, `portOf`, `connect`, `emitAck`, `waitEventWhere`, `readRoomLog` (raw visibility lowercase), типы SubscribeAck/PublishAck. Лотерейные: `activeLotteryRoom` (settings всегда явно — `{}` отклоняется открытым вопросом контракта), `organizerRestToken`/`createPrize`/`fulfillAward`/`revokeAward` (guest-claims Bearer, прецедент transport.e2e:362-367), `organizerSocket` (connect + subscribe).

## Флейки

Не обнаружены: 3 полных прогона, все 7 сценариев стабильны, включая конкурентный сценарий 3 (RoomSerializer делает исход детерминированным — победитель исключается из пула второго draw, отказ всегда PRIZE_FUND_EXHAUSTED, не DRAW_POOL_EMPTY).

## Self-review

- Все 7 сценариев из brief присутствуют; REQ-покрытие brief (RWD-003/004/007/009/010/011/014, SEC-009, RT-004) — на уровне проводов и БД. REQ-RWD-011 (CSPRNG) проверяется косвенно: розыгрыш проходит через `ctx.randomInt` (Math.random запрещён lint-правилом Task 11) — прямой статистический тест CSPRNG в e2e не входил в brief.
- Ловушки HANDOFF применены: waiters до publish/REST; jest.setTimeout(180_000); TRUNCATE с rewards-таблицами; фильтр запуска `lottery.e2e`; organizer guest-claims токен.
- Сомнительных «зелёных» assert'ов нет: каждый сценарий проверяет и wire-кадры, и ack, и состояние БД/лога.
