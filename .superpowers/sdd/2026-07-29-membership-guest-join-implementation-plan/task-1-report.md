# Task 1 Report: SDK — схемы roomJoinPolicy и displayName

## What I implemented

Два новых zod-контракта в пакете `@mymozhem/sdk` (verbatim из brief):

- `packages/sdk/src/membership/room-join-policy.ts` — `ROOM_JOIN_POLICIES` (`['guests', 'registered', 'invite_only']`), `roomJoinPolicySchema` (z.enum), тип `RoomJoinPolicy` (REQ-ID-002, ADR-004).
- `packages/sdk/src/membership/room-join-policy.fixtures.ts` — `validJoinPolicies` / `invalidJoinPolicies`.
- `packages/sdk/src/identity/display-name.ts` — `DISPLAY_NAME_MAX_LENGTH = 40`, `displayNameSchema` (`z.string().trim().min(1).max(40)`), тип `DisplayName` (REQ-ID-003; комментарий про REQ-SEC-009).
- `packages/sdk/src/identity/display-name.fixtures.ts` — `validDisplayNames` / `invalidDisplayNames`.
- Экспорты в `packages/sdk/src/index.ts` (после существующих identity/membership строк, как указано в brief).

Спек-файлы (`room-join-policy.contract.spec.ts`, `display-name.contract.spec.ts`) уже существовали в рабочем дереве как untracked — их содержимое совпало с brief дословно; использованы как есть и закоммичены.

## What I tested and test results

Контрактные тесты из zod-схем (REQ-CTR-005). Финальный прогон:

- Test Suites: 14 passed, 14 total
- Tests: 182 passed (162 существующих + 20 новых — точно по brief)
- lint (`eslint src`): чисто
- typecheck (`tsc --noEmit`): чисто

## TDD Evidence

### RED

Command: `pnpm --filter @mymozhem/sdk test`

Output (ключевое):

```
FAIL src/membership/room-join-policy.contract.spec.ts
    error TS2307: Cannot find module './room-join-policy' or its corresponding type declarations.
    error TS2307: Cannot find module './room-join-policy.fixtures' or its corresponding type declarations.
FAIL src/identity/display-name.contract.spec.ts
    error TS2307: Cannot find module './display-name' or its corresponding type declarations.
    error TS2307: Cannot find module './display-name.fixtures' or its corresponding type declarations.
Test Suites: 2 failed, 12 passed, 14 total
Tests:       162 passed, 162 total
Exit status 1
```

Ожидаемо: модули схем/фикстур ещё не существовали — ровно та причина, что предсказывает brief.

### GREEN

Command: `pnpm --filter @mymozhem/sdk lint && pnpm --filter @mymozhem/sdk typecheck && pnpm --filter @mymozhem/sdk test`

Output:

```
PASS src/membership/room-join-policy.contract.spec.ts
PASS src/identity/display-name.contract.spec.ts
Test Suites: 14 passed, 14 total
Tests:       182 passed, 182 total
```

Lint и typecheck прошли без вывода ошибок.

## Files changed

- Created: `packages/sdk/src/membership/room-join-policy.ts`
- Created: `packages/sdk/src/membership/room-join-policy.fixtures.ts`
- Created: `packages/sdk/src/membership/room-join-policy.contract.spec.ts` (pre-existing untracked, verbatim из brief)
- Created: `packages/sdk/src/identity/display-name.ts`
- Created: `packages/sdk/src/identity/display-name.fixtures.ts`
- Created: `packages/sdk/src/identity/display-name.contract.spec.ts` (pre-existing untracked, verbatim из brief)
- Modified: `packages/sdk/src/index.ts` (+4 export-строки)

## Self-review findings

- Все значения дословно из brief: 3 политики в заданном порядке, `DISPLAY_NAME_MAX_LENGTH = 40`, фикстуры включая Unicode-имя `'Саша'` и `'x'.repeat(41)`.
- Паттерны оформления соответствуют существующим (`identity/identity-kind`, `membership/member-role`): схема + `.fixtures.ts` + `.contract.spec.ts`, `export *` в index.
- Ничего за пределами brief не добавлено (YAGNI): потребителей нет, дефолт `'guests'` только в комментарии (реализация — Task 3).
- Untracked `AGENTS.md` в корне не трогал — вне скоупа задачи.

## Issues or concerns

- Нет. Тестовые счётчики совпали с brief точно (20 новых / 162 существующих).
