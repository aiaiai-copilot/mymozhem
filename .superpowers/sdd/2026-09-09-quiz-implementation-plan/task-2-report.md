# Task 2 report: SDK — роль в join-request (SPECTATOR вход)

## Status: DONE

## What implemented

В `joinRequestSchema` (REQ-ID-003) добавлено необязательное поле `role: z.enum(['participant', 'spectator']).optional()` (REQ-ID-011). Самоназначение зрителем при входе; отсутствие поля = participant-семантика (поле в выводе `undefined`, без default). ORGANIZER/MODERATOR структурно недостижимы через флаг: enum только из двух lowercase-значений, strictObject отсекает лишние ключи. Маппинг wire → MemberRole — Task 8 (ядро), здесь только SDK.

## Files changed

- `packages/sdk/src/auth/join-request.ts` — схема + комментарий (REQ-ID-011)
- `packages/sdk/src/auth/join-request.fixtures.ts` — валидная фикстура с `role: 'spectator'`, невалидная с `role: 'organizer'` (REQ-CTR-005)
- `packages/sdk/src/auth/join-request.contract.spec.ts` — 3 новых контрактных теста (verbatim из брифа)

## TDD evidence

### RED (Step 2)

```
$ pnpm --filter @mymozhem/sdk test -- join-request
FAIL src/auth/join-request.contract.spec.ts
  ● Test suite failed to run
    src/auth/join-request.contract.spec.ts:22:42 - error TS2339: Property 'role' does not exist on type '{ code: string; displayName: string; }'.
```

(Падение на этапе ts-jest-компиляции — тип `JoinRequest` ещё без `role`; это и есть подтверждение, что контракт нового поля ещё не реализован.)

### GREEN (Step 4)

```
$ pnpm --filter @mymozhem/sdk test -- join-request
Test Suites: 1 passed, 1 total
Tests:       16 passed, 16 total
```

Все 3 новых теста проходят:
- accepts explicit spectator role
- defaults to participant semantics: role is optional
- refuses privileged roles through the join flag (organizer / moderator / ORGANIZER / SPECTATOR — все отклонены)

### Полный прогон SDK

```
$ pnpm --filter @mymozhem/sdk test
Test Suites: 22 passed, 22 total
Tests:       266 passed, 266 total
```

## Commit

`eafee47` — feat(sdk): join-request — необязательная роль participant|spectator (REQ-ID-011)
(3 files changed, 21 insertions(+); трейлер Co-Authored-By на месте; push НЕ выполнялся.)

## Self-review findings

- Дифф соответствует брифу verbatim: код схемы и тестов — точь-в-точь как в brief, фикстуры — по образцу существующих пар.
- Case-sensitivity проверена: `'SPECTATOR'` uppercase отклоняется (z.enum строгий) — покрыто тестом.
- `role` без `.default()` — намеренно: отсутствие = participant-семантика, wire-тип не подменяет решение ядра (маппинг в Task 8).
- strictObject сохранён: `extra: true` по-прежнему отклоняется, граница не размягчена.
- Тип `JoinRequest` теперь `{ code: string; displayName: string; role?: 'participant' | 'spectator' }` — обратная совместимость для существующих потребителей (поле опционально, старые payload'ы валидны).
- Регрессий нет: 266/266 тестов SDK зелёные.

## Concerns

Нет.
