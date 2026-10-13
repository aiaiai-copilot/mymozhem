# Task 4 Report: IdentityService.createGuest + ORGANIZER-membership при создании комнаты

**Status:** DONE
**Commit:** `60ee3f68ae5aa2ec36232264e1215d3046b76815` — `feat(core): IdentityService.createGuest + organizer membership on room create (REQ-ID-003, REQ-ID-011)`

## Что реализовано

1. **`packages/core/src/identity/identity.service.ts`** (новый) — `IdentityService.createGuest(displayName, tx = this.prisma)`: валидация через `displayNameSchema` из SDK (ZodError пролетает нетипизированным — осознанное решение), создание identity `kind: 'GUEST'`. `tx` позволяет Task 5 (join) включиться в чужую транзакцию.
2. **`packages/core/src/identity/identity.module.ts`** (новый) — провайдит/экспортирует `IdentityService`.
3. **`packages/core/src/membership/membership.service.ts`** (новый) — `MembershipService.createOrganizerMembership(tx, roomId, identityId)` → `tx.membership.create({ role: 'ORGANIZER' })`.
4. **`packages/core/src/membership/membership.module.ts`** (новый).
5. **`packages/core/src/room/room.service.ts`** — конструктор получил `membership` ПЕРЕД `config`; тело цикла retry в `create` обёрнуто в `this.prisma.$transaction(async tx => { insertRoom(tx,…); createOrganizerMembership(tx,…); })`; `insertRoom` принимает `tx: Prisma.TransactionClient`, `$queryRaw` и re-read идут через `tx`. Retry-цикл снаружи транзакции (комментарий о бессмысленности retry внутри сохранён).
6. **`packages/core/src/room/room.module.ts`** — `MembershipModule` в imports.
7. **Тесты** — новый `identity.service.int-spec.ts` (3 теста verbatim из brief); в `room.service.int-spec.ts` в describe `RoomService lifecycle` добавлен тест атомарного ORGANIZER-membership; обновлены все 3 call-site'а `new RoomService(` (makeService, emptyRegistryService в room.service.int-spec.ts, rooms в realtime/event-log.int-spec.ts) — `new MembershipService(db.prisma)` перед `TEST_CONFIG` (переиспользована существующая константа).

## TDD-хроника

- **RED подтверждён:** `pnpm --filter @mymozhem/core test:int -t "createGuest"` → FAIL, `TS2307: Cannot find module './identity.service'` (как и ожидал brief — компиляция спеки падает).
- **GREEN:** после реализации все прогоны зелёные.

## Прогоны и счётчики

| Команда | Результат |
|---|---|
| `test:int -t "createGuest"` | 1 suite passed, **3 passed** (60 skipped) |
| `test:int -t "ORGANIZER membership"` | 2 suites passed, **2 passed** (regex зацепил и существующий membership-schema тест — ожидаемо) |
| `test:int` (полная лана) | **7 suites, 63 tests passed**, 0 failed, ~37 s |
| `pnpm --filter @mymozhem/core lint` | зелёный, без замечаний |
| `pnpm --filter @mymozhem/core typecheck` | зелёный |
| `pnpm --filter @mymozhem/core test` (unit) | **6 suites, 80 tests passed** |

Счётчик интеграционных вырос 59 → 63 (+3 identity, +1 ORGANIZER-membership).

## Отклонения от brief

1. **Re-read в `insertRoom` сохранён через `tx`** (`tx.room.findUniqueOrThrow`), а не `return rows[0]` как в сниппете brief'а. Причина: `$queryRaw` отдаёт сырое DB-значение enum (`'guests'`), а контракт метода — Prisma-имя (`'GUESTS'`); re-read через клиент выполняет `@map`-маппинг. Launcher'ский контекст явно требовал сохранить эту семантику. Тест `joinPolicy` (`expect(room.joinPolicy).toBe('GUESTS')`) подтверждает корректность.
2. Добавлен короткий комментарий к транзакции в `create` (атомарность пары room+membership, REQ-ID-011) — стилистически в духе файла, не влияет на поведение.

Импорт `Prisma` из `@prisma/client` в room.service.ts действительно уже был (type-only, строка 2) — добавлять не потребовалось.

## Concerns

- Нет блокеров. Тривиальное наблюдение: `-t "ORGANIZER membership"` матчится регэкспом и на pre-existing тест в `membership-schema.int-spec.ts` — счётчик «2 passed» это отражает, не дублирование нового теста.
- `AGENTS.md` (untracked) не тронут и не закоммичен; push не выполнялся.
