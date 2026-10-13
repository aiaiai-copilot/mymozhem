# Task 2 report: drawPool — фильтр swept-гостей (P2)

## Что реализовано

В `MembershipService.listActiveParticipantPool` (снапшот пула розыгрыша для
хост-примитива drawPool) в `where` добавлен фильтр `identity: { deletedAt: null }`:
TTL-swept (анонимизированные `GuestSweepService`) гости исключены из пула розыгрыша —
решение владельца P2. Документирующий комментарий метода дополнен той же нормой.

Изменение — одна строка фильтра + одна int-спека, как и предписывал бриф.

## TDD Evidence

### RED

Команда: `pnpm --filter @mymozhem/core test:int -- membership.service`

```
● MembershipService.join (REQ-ID-002/003/006/013) › listActiveParticipantPool › excludes swept (anonymized) guests from the draw pool (P2)

  - Expected  - 0
  + Received  + 1
    Array [
      "c64562cc-...",
    +   "7719a506-...",   ← swept-гость в пуле
    ]

Tests: 1 failed, 36 passed, 37 total
```

Падение ожидаемое: membership swept-гостя остаётся живым (свип анонимизирует только
строку identity), поэтому без фильтра по `identity.deletedAt` гость попадал в пул.

### GREEN

Та же команда после добавления фильтра:

```
Test Suites: 1 passed, 1 total
Tests:       37 passed, 37 total
```

Полная int-полоса core (шаг 4 брифа): `pnpm --filter @mymozhem/core test:int`

```
Test Suites: 20 passed, 20 total
Tests:       189 passed, 189 total
```

(ERROR-строки `access-revoked handler failed ... listener blew up` в выводе — штатный
лог изоляции обработчиков в существующих тестах exclude, не связаны с изменением.)

Дополнительно прогнаны гейты core: `lint` (eslint src) и `typecheck` (tsc --noEmit) — чисто.

## Files changed

- `packages/core/src/membership/membership.service.ts` — фильтр `identity: { deletedAt: null }`
  в `listActiveParticipantPool` + уточнение docstring.
- `packages/core/src/membership/membership.service.int-spec.ts` — новый вложенный
  `describe('listActiveParticipantPool')` с тестом из брифа, адаптированным под существующий
  харнесс (`makeMembership`, join двух гостей с IP/IP2, прямой update identity как эмуляция свипа).

## Self-review

- Дифф минимален (20 insertions, 1 deletion), YAGNI соблюдён: никаких изменений за пределами
  одного фильтра и одного теста; `app-runtime.int-spec.ts` не тронут (пул там покрыт косвенно,
  бриф это явно разрешил).
- Тест проверяет реальное поведение: RED-прогон показал swept-гостя в пуле, GREEN — только
  живого. Порядок в `toEqual` безопасен: после фильтра в пуле ровно один элемент.
- Эмуляция свипа (`deletedAt + displayName: null`) повторяет ровно то, что пишет
  `GuestSweepService.sweepExpiredGuests` (updateMany identity), не выдуманное состояние.
- Комментарии на русском, формат «почему», по стилю репо.

## Concerns

Нет.
