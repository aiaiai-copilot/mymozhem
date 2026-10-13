# Task 8 Report: Свип += joinIp/Exclusion (срез ADR-012 zero-PII MVP, батч C)

**Status:** DONE
**Commit:** `5e837c1` — feat(core): свип += joinIp/Exclusion (ADR-012 §3) — IP не живёт дольше события + guest_ttl; приостановка гардой сохраняет IP до разрешения award

## What was implemented

1. **`packages/core/src/identity/guest-sweep.service.ts`** — в транзакцию `sweepExpiredGuests` добавлены два оператора (код из брифа дословно), позиция строго по брифу: после отзыва сессий, ДО re-check'а C-8.1:
   - `tx.membership.updateMany({ where: { identityId: { in: sweepIds } }, data: { joinIp: null } })`
   - `tx.exclusion.deleteMany({ where: { identityId: { in: sweepIds } } })`
   Оба внутри существующей tx — откат C-8.1 (гонка с award) отменяет и их. Никакого catch unique-violation внутри транзакции (deleteMany/updateMany идемпотентны по `in: sweepIds`).

2. **`packages/core/src/identity/guest-sweep.int-spec.ts`** — новый describe `ADR-012 §3: IP не живёт дольше события + guest_ttl` (testcontainer, сидирование напрямую, по образцу существующих describe'ов файла):
   - Тест 1: expired-гость с `membership.joinIp='10.1.2.3'` + `Exclusion`; свежий гость с `joinIp='10.9.9.9'` — контрольная группа. После свипа: swept=1, joinIp=null, Exclusion=0; у свежего joinIp на месте (REQ-ID-006, живой контур не тронут).
   - Тест 2: guard-фейк (`FakeGuard` с управляемым `Set<string> open`, wiring через @Global-модуль по образцу guard-тестов файла) приостанавливает гостя → swept=0, joinIp/Exclusion на месте; после очистки фейка следующий проход свипит и чистит IP-след.
   - Хелперы: `seedRoom()` (одна на тест — `Identity_single_registered_key` запрещает второго живого REGISTERED; первая редакция с организатором на гостя падала именно на этом) и `seedGuestWithIp(room, org, {expired, ip, excluded})`.

3. **`packages/core/src/membership/membership.service.int-spec.ts`** (describe `listActiveParticipantPool`, тест «excludes swept (anonymized) guests from the draw pool (P2)», ~строки 321-340 по ruling C-pre.3) — ручная симуляция свипа дополнена `membership.updateMany({ joinIp: null })` + `exclusion.deleteMany` с комментарием о синхронизации.

### Выбор в шаге 4: симуляция, не реальный свип

Выбрано **дополнение ручной симуляции**, зафиксировано в сообщении коммита. Обоснование: реальный `sweepExpiredGuests` выбирает кандидатов по TTL от `createdAt` — оба гостя теста («Живой» и «Сметённый») создаются в одну миллисекунду, поэтому любой `now`, делающий одного expired, делает expired и другого; кроме того, смёлся бы посеянный в `beforeAll` P1-GUEST, живущий через весь файл (afterEach транкейтит только membership/room). Спеке `listActiveParticipantPool` нужен ровно один swept-гость — семантика реального свипа это сломать бы не могла без перекройки теста. Предпочтение «реальный вызов, если не ломает устройство спеки» здесь неприменимо: ломает.

## TDD Evidence

### RED

```
$ pnpm --filter @mymozhem/core test:int -- guest-sweep.int-spec
● ADR-012 §3 › свип обнуляет joinIp членств и удаляет Exclusion свипнутой identity
  expect(received).toBeNull()
  Received: "10.1.2.3"          (guest-sweep.int-spec.ts:439)
● ADR-012 §3 › приостановленная гардой identity … сохраняет joinIp и Exclusion до следующего свипа
  expect(received).toBeNull()
  Received: "10.1.2.3"          (guest-sweep.int-spec.ts:465)
Tests: 2 failed, 5 passed, 7 total
```

Падение ожидаемое: реализация ещё не добавлена — свип не трогает `joinIp`. (Промежуточный красный прогон также поймал мою ошибку сидирования — двойной REGISTERED-организатор против partial index `Identity_single_registered_key`; исправлено выносом `seedRoom()` до того, как зафиксирован чистый RED выше.)

### GREEN

```
$ pnpm --filter @mymozhem/core test:int -- guest-sweep.int-spec
PASS src/identity/guest-sweep.int-spec.ts
  ADR-012 §3: IP не живёт дольше события + guest_ttl
    ✓ свип обнуляет joinIp членств и удаляет Exclusion свипнутой identity (57 ms)
    ✓ приостановленная гардой identity (открытый award) сохраняет joinIp и Exclusion до следующего свипа (14 ms)
Tests: 7 passed, 7 total

$ pnpm --filter @mymozhem/core test:int -- membership.service.int-spec
Tests: 42 passed, 42 total
```

## Full gates (после реализации, перед коммитом)

- `pnpm build` — 6/6 successful
- `pnpm boundary-check` — no dependency violations (725 modules)
- `pnpm guardrails` — all 10 guardrails alive
- `pnpm lint` — 6/6 successful
- `pnpm typecheck` — 10/10 successful
- `pnpm test` — все пакеты зелёные (server: 65/65 и т.д.)
- `pnpm --filter @mymozhem/core test:int` — **23 suites, 220 tests, все passed** (полный прогон int, ловит дрейф int-спек вне root typecheck)

## Files changed

- `packages/core/src/identity/guest-sweep.service.ts` (+11)
- `packages/core/src/identity/guest-sweep.int-spec.ts` (+117)
- `packages/core/src/membership/membership.service.int-spec.ts` (+10)

## Self-review findings

- **Позиция в tx:** новые операторы после `session.updateMany`, до re-check C-8.1 — откат при гонке с award отменяет и очистку IP (проверено чтением diff; существующий C-8.1 тест зелёный).
- **Только sweepIds:** updateMany/deleteMany по `{ in: sweepIds }` — приостановленные гардой identity не попадают в выборку (тест 2 подтверждает обе стороны: приостановка сохраняет, разрешение чистит).
- **Живой контур (REQ-ID-006):** контрольная группа (свежий гость) в тесте 1 подтверждает, что до свипа joinIp работает как прежде; exclusion/rejoin тесты membership-спеки (42/42) не затронуты.
- **YAGNI:** фейк-гард вместо поднятия RewardsModule (гарда покрыта сьютом REQ-RWD-013); хелперы без лишних опций; describe с `PRIZE_MODE: 'on'` (T7) не тронут.
- **Тесты проверяют поведение:** RED был по правильной причине (joinIp не null), не по склейке.

## Issues / concerns

Нет. Замечание для контроллера: брифовый якорь «296-302» для membership-спеки подтверждённо устарел (ruling C-pre.3) — фактический блок в describe `listActiveParticipantPool`, строки ~321-340 после правки.
