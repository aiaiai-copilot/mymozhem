# Task 12 review: e2e лотереи (apps/server/test/lottery.e2e-spec.ts)

**Reviewed commit:** `f5a74e2` (diff 2b69756..f5a74e2, 1 file, +472).
**Inputs:** task-12-brief.md, task-12-report.md, review-2b69756..f5a74e2.diff. Код проверен read-only против источников (join.controller.ts, lottery-handlers.ts, app-runtime.service.ts, room-serializer.ts, rewards.service.ts, realtime-messages.ts, room.service.ts). Прогон не повторялся (3 зелёных прогона заявлены исполнителем).

## Spec compliance (brief as amended by controller rulings)

| # | Сценарий | Вердикт | Проверка |
|---|----------|---------|----------|
| 1 | Полный цикл: live + replay + fulfill | ✅ | Waiters до publish (spec:280-281); winner из пула; `not.toHaveProperty('displayName')` на draw.completed (REQ-SEC-009); reward.awarded с тем же winnerId; БД: AWARDED + sourceAppId 'lottery', quantity 1→0; replay через snapshot нового подписчика (REQ-RT-004); REST fulfill → 200 + live rewards.reward.fulfilled + FULFILLED в БД (REQ-RWD-004). |
| 2 | Идемпотентность drawId | ✅ | Повтор → `{ok:true}` (no-op, не отказ), award count = 1, quantity 2→1, в логе два draw.completed с идентичным payload (re-emit). REQ-RWD-003 на уровне app-команды — на проводе и в БД. |
| 3 | K>quantity | ✅ | Promise.all двух draw.run на одном сокете — конкурентно на транспорте; RoomSerializer (room-serializer.ts, вызов в app-runtime.service.ts:55) сериализует per-room — исход детерминирован: ровно 1 ok, ровно 1 `PRIZE_FUND_EXHAUSTED`, quantity 0, award count 1 (REQ-RWD-010 e2e-версия). Комментарий в тесте точно описывает механику (отказ декремента откатывает транзакцию — подтверждено rewards.service.ts:88-91). |
| 4 | Eligibility verified | ✅ | Соответствует рулингу D-pre.2 (один детерминированный розыгрыш, не 10-draw sketch). Winner-exclusion подтверждён в коде (lottery-handlers.ts:48-54 — прежние победители приза вне пула). Посадка REGISTERED через БД оправдана: JoinController.join (join.controller.ts:21-32) не читает Authorization и всегда создаёт гостя через membership.join — HTTP registered-join в MVP отсутствует, claim верен. Пул читается из membership-таблицы (app-runtime.service.ts:128 `listActiveParticipantPool`), значит DB-seed — честный продуктовый путь. Assertion строгий: `toEqual({drawId, prizeId, winnerId: REG})` на кадре + winnerId в строке Award (REQ-RWD-014). |
| 5 | Revoke | ✅ | Соответствует рулингу D-12.2 (re-draw уходит ДРУГОМУ участнику, не «тому же победителю» — sketch brief противоречил winner-exclusion). quantity возвращён ровно один раз: двойной revoke → 200 no-op, quantity остаётся 1 (REQ-RWD-007 полностью). Новый AWARDED другому участнику детерминированно; лог: 1 revoked + 2 awarded. Побочное наблюдение отчёта (расхождение DB partial-index и handler-level exclusion) подтверждено кодом и корректно эскалировано владельцу, не изменено молча. |
| 6 | REQ-RWD-009 при COMPLETED | ⚠️ частично | GET /rooms/:id/rewards → 200, 1 AWARDED; fulfill → 200, FULFILLED. Но REQ-RWD-009 гласит «вручить **или отозвать** каждую» — revoke после COMPLETED не проверен (sketch brief тоже содержал только fulfill, так что брифу соответствует; см. Issues #1). |
| 7 | Publish-гейты | ✅ | draw.completed от гостя → PUBLISH_FORBIDDEN (clientInitiated=false, гейт диспетчера — app-runtime.service.ts:102-104); draw.run от PARTICIPANT → PUBLISH_FORBIDDEN (отказ модуля, lottery-handlers.ts:22-24). |

**Глобальные ограничения:**
- Реальный AppModule без APP_MANIFESTS/APP_RUNTIME_MODULES override'ов — ✅ (createApp() вызывается без аргументов в beforeAll).
- TRUNCATE включает rewards."Award" и rewards."Prize" — ✅ (spec:180; CASCADE покрывает realtime."LogEvent" и rewards."PointsGrant"). identity."Identity" сознательно не в списке — ORG-seed из beforeAll переживает afterEach, что и требуется.
- Waiters навешаны до publish/REST во всех сценариях — ✅.
- Ретраев нет — ✅.
- displayName в draw.completed не утекает — ✅ assertion присутствует.

**REQ-покрытие (заявленное → фактическое):**
- REQ-RWD-003 ✅ (сц. 2), REQ-RWD-004 ✅ (сц. 1), REQ-RWD-007 ✅ (сц. 5, двойной отзыв), REQ-RWD-010 ✅ (сц. 3), REQ-RWD-014 ✅ (сц. 4), REQ-SEC-009 ✅ (сц. 1, draw.completed), REQ-RT-004 ✅ (сц. 1, replay snapshot).
- REQ-RWD-009 ⚠️ — fulfill после COMPLETED проверен, revoke после COMPLETED нет (текст REQ включает оба).
- REQ-RWD-011 — только косвенно: розыгрыш идёт через ctx.randomInt = node:crypto.randomInt (app-runtime.service.ts:126), Math.random в packages/app-* запрещён lint-правилом. Статистический тест CSPRNG в e2e невозможен и не входил в brief — принимается как задокументированное ограничение.

## Strengths

- Оба отклонения (D-pre.2 и D-12.2) применены точно, с комментариями в коде, ссылающимися на рулинги и причины; третье отклонение (DB-seed registered membership) проверено против join.controller.ts — claim исполнителя верен дословно.
- Assertion'ы сильные: точный `toEqual` payload в сц. 4; тройная проверка (wire-кадр + ack + БД/лог) почти в каждом сценарии; тавтологий нет.
- Конкурентный сценарий действительно конкурентен на транспорте (Promise.all на одном сокете), а детерминизм исхода обоснован реальным механизмом (RoomSerializer + транзакционный откат), а не надеждой.
- Гигиена: все сокеты закрываются в каждом тесте; комнаты изолированы per-test + TRUNCATE; порядковой зависимости между тестами нет.
- Хелперы standalone (санкционированное отклонение Quiz-среза), publishRequestSchema-форма `{type, payload}` подтверждена (realtime-messages.ts:38-42 — strictObject без roomId).

## Issues

### Critical
Нет.

### Important
Нет.

### Minor

1. **REQ-RWD-009: revoke после COMPLETED не проверен** — apps/server/test/lottery.e2e-spec.ts:442-467. Текст REQ: «с возможностью вручить **или отозвать** каждую». Сценарий 6 проверяет только fulfill. Failure scenario: если revoke-эндпоинт (или его commit-путь) когда-нибудь получит ACTIVE-гейт, которого нет у fulfill, регрессия пройдёт незамеченной — сейчас оба идут одним статическим путём (rewards.service.ts:123-160), поэтому риск низкий, но покрытие REQ неполное. Fix: три строки — revokeAward после complete + assert status REVOKED + quantity возвращён.

2. **REQ-SEC-009 проверен только на draw.completed, не на rewards.reward.awarded** — spec:290-291. Кадр reward.awarded проверяется лишь на winnerId; отсутствие displayName в нём не assert'ится (payload по построению id-only — rewards.service.ts:92-98 — но это проверка реализации, не провода). Failure scenario: будущее изменение добавит displayName в reward.awarded — тест не упадёт. Fix: `expect((await rewardFrame).payload).not.toHaveProperty('displayName')`.

3. **Replay-проверка в сц. 1 — новый гость, не «переподключённый»** — spec:299 («Гость-1-снова» создаёт новую identity через joinGuest). Brief говорил «переподключённый гость». Публичная replay-видимость (суть REQ-RT-004) проверена полностью — новый подписчик видит оба события в snapshot; разница чисто семантическая (новый join vs reconnect той же identity). Косметика, соответствие духу брифа есть.

4. **waitEventWhere/emitAck без внутреннего таймаута** — spec:98-119. Пропущенный кадр или ack повесит тест до общего jest.setTimeout(180_000), затрудняя диагностику (прецедент quiz.e2e, санкционированный паттерн). Не флейк-маскировка — просто медленный фейл. Не блокирует.

## Cannot verify from diff

- Фактические 3 зелёных прогона (7/7) — принято на веру по отчёту, перезапуск не выполнялся по инструкции.
- Непредсказуемость CSPRNG (REQ-RWD-011) — принципиально не тестируется e2e; косвенное покрытие (путь через ctx.randomInt + lint-запрет Math.random) задокументировано исполнителем честно.

## Verdict

**Approved.** Все 7 сценариев соответствуют брифу с учётом рулингов D-pre.2 и D-12.2; оба рулинга выверены против кода и применены правильно. Два документированных отклонения обоснованы и подтверждены (registered-join по HTTP действительно отсутствует; winner-exclusion действительно делает sketch'и brief невозможными). Замечания — только Minor; #1 и #2 можно закрыть дёшево, но они не блокируют приёмку.
