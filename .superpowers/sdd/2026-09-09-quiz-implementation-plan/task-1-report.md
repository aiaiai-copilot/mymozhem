# Task 1 Report — SDK: контракт 1.5.0 + новые wire-коды ошибок

## What was implemented

- `CONTRACT_VERSION` поднят `1.4.0` → `1.5.0` (`packages/sdk/src/contract-version.ts`).
- `packages/sdk/package.json`: `"version": "1.5.0"` (parity с CONTRACT_VERSION, REQ-CTR-004).
- В `CONTRACT_ERROR_CODES` (`packages/sdk/src/errors/error-codes.ts`) перед `'INTERNAL_ERROR'` добавлен блок из 7 кодов фазы 2 с комментарием из брифа: `MODULE_UNAVAILABLE`, `PUBLISH_FORBIDDEN`, `ANSWER_TOO_FAST`, `ROUND_NOT_OPEN`, `ALREADY_ANSWERED`, `QUESTION_UNKNOWN`, `OPTION_UNKNOWN`. Тип `ContractErrorCode` и `contractErrorCodeSchema` подхватывают их автоматически (z.enum поверх tuple).

## Tests and results

- `pnpm --filter @mymozhem/sdk test` — 22 suites, 261 tests, all PASS.
- `pnpm --filter @mymozhem/sdk typecheck` — PASS.
- `pnpm --filter @mymozhem/sdk lint` — PASS.

## TDD Evidence

**RED** — после добавления в `error-codes.contract.spec.ts` блока `it.each([...7 кодов])('accepts phase-2 code %s')` и расширения exact-list теста:

```
pnpm --filter @mymozhem/sdk test
Test Suites: 1 failed, 21 passed, 22 total
Tests:       8 failed, 253 passed, 261 total
```

Падают ровно ожидаемое: 7 параметризованных тестов `accepts phase-2 code %s` (`contractErrorCodeSchema.safeParse(code).success` → `false`, кодов ещё нет в enum) + exact-list тест `exports exactly the codes named by the design §8` (список в тесте длиннее фактического массива).

**GREEN** — после добавления кодов в `error-codes.ts` и подъёма версии до 1.5.0 потребовалась одна поправка существующего фикстурного теста (см. Self-review), затем:

```
pnpm --filter @mymozhem/sdk test
Test Suites: 22 passed, 22 total
Tests:       261 passed, 261 total
```

## Files changed

- `packages/sdk/package.json` (version 1.4.0 → 1.5.0)
- `packages/sdk/src/contract-version.ts` (CONTRACT_VERSION → '1.5.0')
- `packages/sdk/src/contract-version.contract.spec.ts` (фикстура несовместимого диапазона)
- `packages/sdk/src/errors/error-codes.ts` (+7 кодов с комментарием)
- `packages/sdk/src/errors/error-codes.contract.spec.ts` (+it.each блок, расширен exact-list)

## Self-review findings

1. **Поправка фикстуры за пределами буквы брифа (необходимая):** в `contract-version.contract.spec.ts:30` фикстура несовместимого диапазона была `'>=1.5.0'` — «следующий minor от текущего». После подъёма контракта до 1.5.0 этот диапазон стал совместимым, и тест упал. Заменено на `'>=1.6.0'` — семантика фикстуры («диапазон выше текущей версии контракта») сохранена. Без этого GREEN недостижим; бриф упоминает parity-тест версии, и эта правка — его часть.
2. Exact-list тест `exports exactly the codes...` расширен новыми кодами в том же порядке, что и в массиве (перед `INTERNAL_ERROR`) — иначе он бы упал на GREEN.
3. Диф минимален: 30 insertions, 3 deletions, 5 файлов, все внутри `packages/sdk`. Никаких изменений вне границ задачи.

## Issues / concerns

- Нет. Коды добавлены, но пока нигде не используются — это по плану (потребители: Task 6 app-runtime, Task 11 quiz handlers).
