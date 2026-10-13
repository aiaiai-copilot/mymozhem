# Отчёт о фиксах финального whole-branch review — батч B (Tasks 4–6)

Дата: 2026-09-22. Ветка: rewards-lottery (worktree .worktrees/rewards-lottery).

## F1 (Important): no-op дубля награды без отравления транзакции

**Проблема.** `awardPrize` ловил P2002 от `tx.award.create` и возвращался в той же
транзакции. В Postgres unique-violation абортит транзакцию: каждый следующий
statement падает с 25P02, COMMIT абортнутой tx молча откатывает. Старый тест дубля
проходил только потому, что после catch ничего не писалось.

**RED.** Тест «конкурентный дубль одного награждения» перестроен: повторное
награждение батчится с `award.points` в ОДНОМ `executeEffects` (дубль первым, до
points), прогоны — последовательные (детерминированный конфликт; конкурентная
версия через `Promise.allSettled` оказалась недетерминированной — при выигрыше
батч-прогона гонки тест зелёный и на старом коде). На старом коде — падение:
`DriverAdapterError: current transaction is aborted, commands ignored until end of
transaction block` (25P02), что подтверждает premise находки на Prisma 7.8 +
adapter-pg.

**Фикс.** try/catch заменён не-возбуждающим insert'ом (выбранная форма — двухшаговая,
без RETURNING):

```sql
INSERT INTO rewards."Award" (id, "roomId", "prizeId", "winnerId", "sourceAppId")
VALUES (gen_random_uuid(), ${roomId}::uuid, ${prizeId}::uuid, ${winnerId}::uuid, ${sourceAppId})
ON CONFLICT ("roomId", "prizeId", "winnerId") WHERE "status" IN ('AWARDED', 'FULFILLED') DO NOTHING
```

- `$executeRaw` возвращает affected-rows: 0 → типизированный no-op, ранний return
  ДО декремента (фонд не тратится); 1 → id вставленной строки перечитывается
  `tx.award.findFirstOrThrow` по ключу индекса (roomId, prizeId, winnerId,
  status IN AWARDED/FULFILLED) — RETURNING через `$queryRaw` под adapter-pg обойдён
  сознательно (HANDOFF: re-read-прецедент insertRoom; сырое DB-значение enum и
  десериализация RETURNING — известные ловушки).
- Конфликт-таргет с WHERE-предикатом 1:1 повторяет частичный уникальный индекс
  `Award_single_active_winner_per_prize_key` (миграция 20260910171833).
- Не-nullable колонок без DB-дефолта, кроме перечисленных, в модели Award нет
  (status/createdAt — дефолты БД, fulfilledAt/revokedAt/prizeId — nullable);
  `gen_random_uuid()` — встроенная в PG13+, согласована с `@default(uuid())`.
- Дальше — прежние guarded-декремент фонда и `commitRewardsEvent` (payload только
  id, REQ-SEC-009).

**GREEN.** rewards.int-spec: 7/7, включая усиленный тест (1 награда, quantity −1
ровно раз, PointsGrant дубль-прогона закоммичен ровно раз).

## F2 (Important, forward boundary): фильтр-спека без импорта rewards.errors

`http-exception.filter.spec.ts` больше не импортирует `../rewards/rewards.errors`
(boundary-правило Task 11 круизит и спеки). Четыре rewards-кейса
(PRIZE_UNKNOWN, AWARD_UNKNOWN, PRIZE_FUND_EXHAUSTED, REWARD_ALREADY_RESOLVED)
кидают голый `new ContractError(<code>, 'x')` из `@mymozhem/sdk` — ветка фильтра
срабатывает по классу ContractError + членству кода в STATUS_BY_WIRE_CODE, что эти
кейсы и проверяют. Кейс ROOM_NOT_ACTIVE оставлен на настоящем RoomNotActiveError
(ветка RealtimeError).

## F3 (Minor): комментарий ветки RealtimeError + пин-кейс

Комментарий в `http-exception.filter.ts` исправлен: ветка охраняется членством в
STATUS_BY_WIRE_CODE и сейчас матчит два realtime-кода — ROOM_NOT_ACTIVE (409) и
ACTOR_NOT_MEMBER (403, realtime-вариант из realtime.errors.ts; тот же wire-код и
статус, что у membership-варианта). Добавлен пин-кейс в спеку: realtime
`ActorNotMemberError` (алиас-импорт `RealtimeActorNotMemberError` из
`../realtime/realtime.errors`) → 403, body ровно `{code: 'ACTOR_NOT_MEMBER'}`.

## Верификация

- `pnpm --filter @mymozhem/core test -- http-exception` → 33/33 (включая новый пин).
- `pnpm --filter @mymozhem/core test:int -- rewards` → 7/7.
- `pnpm build` → 4/4 пакета.
- `pnpm --filter @mymozhem/core test` → 18 сьютов, 223/223.
- `pnpm --filter @mymozhem/core test:int` → 19 сьютов, 177/177.

## Отклонения от задания

1. Тест дубля сделан последовательным, а не конкурентным: конкурентная форма
   (`Promise.allSettled` двух прогонов) недетерминирована — при выигрыше гонки
   батч-прогоном RED не воспроизводится. Последовательная форма сохраняет все
   требуемые утверждения (дубль первым в батче, PointsGrant закоммичен, одна
   награда, quantity −1 ровно раз) и детерминированно краснит старый код.
2. Форма insert — двухшаговая ($executeRaw + findFirstOrThrow), без RETURNING:
   выбрана сразу по заметкам HANDOFF об adapter-pg, без эксперимента с $queryRaw.
