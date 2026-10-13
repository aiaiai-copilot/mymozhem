# Task 1 report: ajv-formats на commit-гейте (enforcement `format: "uuid"`)

## What I implemented

- Добавил dep `ajv-formats: ^3.0.1` в `packages/core/package.json` (рядом с `ajv`); `pnpm install` из корня worktree — lockfile обновлён (один lockfile, REQ-DEV-002).
- В `AppRegistryService` перенёс инициализацию Ajv из инициализатора поля в конструктор: `private readonly ajv: Ajv2020;` + первой строкой конструктора `this.ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(this.ajv);`. Существующий комментарий про Ajv2020/strict перенесён к объявлению поля; новый комментарий про ajv-formats добавлен в конструктор — всё verbatim по брифу.
- Расширил существующий `app-registry.service.spec.ts` блоком `eventValidatorFor — string formats` (verbatim по брифу): невалидный `drawId: 'not-a-uuid'` отклоняется, RFC 9562 uuid принимается.

## TDD Evidence

### RED

Команда: `pnpm --filter @mymozhem/core test -- app-registry` (фильтр матчил 3 suites — проверено).

```
● eventValidatorFor — string formats › rejects a non-uuid drawId
  expect(received).toBe(expected) // Object.is equality
  Expected: false
  Received: true
  > 120 |     expect(validate({ drawId: 'not-a-uuid' })).toBe(false);

Test Suites: 1 failed, 2 passed, 3 total
Tests:       1 failed, 36 passed, 37 total
```

Падение ожидаемо: stock Ajv 8 без ajv-formats игнорирует `format: "uuid"` (warning `unknown format` виден в стеке компиляции схемы), поэтому валидатор пропускал невалидный uuid.

### GREEN

Команда: `pnpm --filter @mymozhem/core test`

```
Test Suites: 18 passed, 18 total
Tests:       215 passed, 215 total
```

(Перед GREEN потребовался `pnpm --filter @mymozhem/core prisma:generate` — в свежем worktree Prisma Client не был сгенерирован, из-за чего 6 Prisma-трогающих suites не компилировались (`TS2339: Property '$disconnect' does not exist on type 'PrismaService'`). Это инфраструктурная подготовка worktree, не связана с изменением; после generate все suites зелёные.)

## Test results (полный регрессионный прогон, Step 4)

| Прогон | Команда | Результат |
|---|---|---|
| Unit (core) | `pnpm --filter @mymozhem/core test` | 18/18 suites, 215/215 тестов — PASS |
| Build | `pnpm build` | 4/4 tasks — PASS |
| Integration (core) | `pnpm --filter @mymozhem/core test:int` | 16/16 suites, 159/159 тестов — PASS (77.6s, testcontainers) |
| e2e (server) | `pnpm --filter @mymozhem/server test` (после build) | 5/5 suites, 58/58 тестов — PASS |
| Lint (core) | `pnpm --filter @mymozhem/core lint` | чисто |
| Typecheck (core) | `pnpm --filter @mymozhem/core typecheck` | чисто |

## Files changed

- `packages/core/package.json` — dep `ajv-formats: ^3.0.1`
- `pnpm-lock.yaml` — ajv-formats 3.0.1
- `packages/core/src/app-registry/app-registry.service.ts` — addFormats на commit-гейте
- `packages/core/src/app-registry/app-registry.service.spec.ts` — новый describe-блок

## Invalid-uuid литералы в int/e2e-спеках

**Замен не потребовалось.** Все 16 int-suites и все 5 e2e-suites прошли зелёными с включённым enforcement — существующие литералы uuid в спеках уже RFC 9562-валидны (видимо, почистили раньше при переходе на zod v4 / прецедент `quiz.e2e-spec.ts:26-28`).

## Self-review findings

- Diff прочитан целиком: 4 файла, 32+/1−, точно по брифу, ничего лишнего (нет случайных изменений, нет кода «на вырост»).
- Тест проверяет реальное поведение гейта: идёт через публичный `eventValidatorFor`, а не через прямой вызов Ajv; RED доказал, что тест ловит отсутствие enforcement (validate возвращал true).
- Комментарии по проектному стилю (по-русски, с привязкой к решению владельца и фазе/задаче).
- Commit conventional, по-русски, с Co-Authored-By; push не выполнялся.

## Issues / concerns

- Единственное: свежий worktree требовал `prisma:generate` перед unit-прогоном — стоит держать в уме для следующих сессий в этом worktree (уже сделано, повторно не понадобится). На результат не влияет.
- Ajv-warning `unknown format "uuid" ignored` из stderr исчез — цель follow-up финального ревью ф.2 закрыта.
