# Task 7 report: prize_mode-гейт + lottery v2 (ADR-012 §4, батч C)

## What was implemented

**Lottery v2 (REQ-RWD-002b, REQ-RWD-014, REQ-DEV-007):**
- `lottery-events.ts`: `drawRunPayload.prizeId` — `z.uuid().optional()`; `drawCompletedPayload.prizeId` — `z.uuid().nullable()` (ключ обязателен, nullable ≠ optional).
- `lottery-settings.ts`: `lotterySettingsSchema = z.strictObject({})` — draw_eligibility удалена (verified-ветка REQ-RWD-014 приостановлена), схема сохранена как точка расширения.
- `lottery-handlers.ts`: ветка settings/verified и `lotterySettingsSchema.parse(ctx.settings)` удалены; `prizeId = command.prizeId ?? null`; winner-exclusion по ключу prizeId (null — отдельный пул безпризовых победителей, решение §0.4); эффект `award.prize` только при реальном prizeId.
- `lottery-state.ts`: `draws[*].prizeId: string | null`.
- `lottery-manifest.ts`: `LOTTERY_MANIFEST_VERSION = 2` с комментарием.

**prize_mode-гейт (REQ-SEC-006, REQ-RWD-009, решение §0.3):**
- `rewards.errors.ts`: `PrizesDisabledError extends ContractError` (wire `PRIZES_DISABLED`).
- `rewards.service.ts`: конструктор += `@Inject(APP_CONFIG) private readonly config: AppConfig`; первая строка `createPrize` и `awardPrize` — гейт `if (this.config.PRIZE_MODE === 'off') throw new PrizesDisabledError()`. Гейт в awardPrize стоит ДО findFirst (отказ PRIZES_DISABLED, не PRIZE_UNKNOWN — запинано поведенчески e2e RF3 произвольным uuid).
- `rewards.module.ts`: imports += `ConfigModule`.
- `http-exception.filter.ts`: `STATUS_BY_WIRE_CODE` += `PRIZES_DISABLED: 403` + строка в спеке.
- fulfill/revoke/listAwards сознательно вне гейта (REQ-RWD-009) — покрыто тестом.

**Blast radius (рулинг C-pre.1):**
- `rewards.int-spec.ts`, `rewards.controller.int-spec.ts`: базовый override → `{...TEST_CONFIG, PRIZE_MODE: 'on'}`; новые describe гейта — отдельные модули/app при `'off'` (дефолт TEST_CONFIG).
- `app-runtime.int-spec.ts:645`: ручное конструирование `new RewardsService(..., { ...TEST_CONFIG, PRIZE_MODE: 'on' })`.
- `guest-sweep.int-spec.ts` (REQ-RWD-013 describe): override → `PRIZE_MODE: 'on'` — **отклонение от рулинга** («не трогай»): посылка рулинга («только prisma.award.create + fulfill/revoke») неточна — строки 224/238 исполняют эффект `award.prize` через `rewards.executeEffects`, при `'off'` тест красный. Изменение чисто конфигурационное, проверяемое поведение (свип vs открытая награда) не тронуто. Остальные два describe файла не используют призовой путь и не изменены.
- `rooms-lifecycle.controller.int-spec.ts`: локальный манифест → `manifestVersion: 2` + `z.strictObject({})`; configure-вызов лотереи → `manifestVersion: 2`.

**e2e (`apps/server/test/lottery.e2e-spec.ts`):**
- `LOTTERY_SETTINGS = {}`; verified-сценарий (бывший `it.skip`, ~352) и константа `REG` удалены.
- Жизненный цикл БД/сида ORG поднят на уровень файла (одна testcontainer-БД на оба сьюта); helpers вынесены в file-scope.
- Main describe: `process.env.PRIZE_MODE = 'on'` в beforeAll до `createApp()` с save/restore в afterAll (прецедент JWT_SECRET).
- Новый сценарий 4 (безпризовой): draw.run без prizeId → draw.completed `prizeId=null`, winner из пула; GET /rooms/:id/rewards пуст; второй безпризовой draw → другой победитель (null-ключ §0.4); `award.count === 0`.
- Новый describe `Lottery prize_mode=off`: второй app-инстанс (`createApp({ PRIZE_MODE: 'off' })`) на той же БД; RF3 — draw.run с произвольным uuid prizeId → ack `{code: 'PRIZES_DISABLED'}`, в логе нет ни draw.run, ни draw.completed (откат dispatch), awards 0; контроль — безпризовой draw при off работает.

## Test results

- `pnpm --filter @mymozhem/app-lottery test` — 39/39 PASS; `build` OK.
- `pnpm --filter @mymozhem/core test -- http-exception.filter` — 34/34 PASS.
- `pnpm --filter @mymozhem/core test:int` — 23 suites, 218/218 PASS (включая rewards, rewards.controller, app-runtime, rooms-lifecycle, guest-sweep).
- `pnpm --filter @mymozhem/server test -- lottery.e2e` — 8/8 PASS (7 призовых/безпризовых при on + 1 RF3 при off).
- Гейты: `pnpm build` ✓, `boundary-check` ✓ (0 violations, 725 modules), `guardrails` ✓, `lint` ✓, `typecheck` ✓, `pnpm test` ✓ (10 задач; server 65/65).
- Перед server e2e пересобраны dist: `pnpm --filter @mymozhem/core build && pnpm --filter @mymozhem/app-lottery build`.

## TDD evidence

**Волна 1 (lottery v2) — RED:** `pnpm --filter @mymozhem/app-lottery test` после правок спек до реализации:
```
Test Suites: 2 failed, 1 passed, 3 total
Tests:       6 failed, 19 passed, 25 total
```
Падали: manifestVersion 2, отказ drawEligibility-ключа (registered schema), draw.run без prizeId → valid, draw.completed prizeId=null → valid, безпризовые handler-кейсы (effects [], null-ключ exclusion) — ожидаемо: реализация ещё v1 (prizeId обязателен, verified-ветка жива).
**GREEN:** после реализации `Tests: 39 passed, 39 total`.

**Волна 2 (prize_mode-гейт) — RED:**
- `pnpm --filter @mymozhem/core test -- http-exception.filter`: `Expected: 403, Received: 500` (PRIZES_DISABLED не в STATUS_BY_WIRE_CODE → INTERNAL_ERROR).
- `pnpm --filter @mymozhem/core test:int -- rewards.int-spec`: `Tests: 2 failed, 11 passed` — «off: createPrize» и «off: award.prize effect» resolved вместо reject PRIZES_DISABLED (гейта нет); существующие 9 кейсов зелёные при базовом override `'on'`.
**GREEN:** после реализации — filter 34/34, rewards.int-spec 13/13, rewards.controller 5/5, app-runtime 21/21; e2e 8/8.

## Files changed

- `packages/app-lottery/src/lottery-events.ts`, `lottery-settings.ts`, `lottery-handlers.ts`, `lottery-state.ts`, `lottery-manifest.ts`
- `packages/app-lottery/src/lottery-manifest.contract.spec.ts`, `lottery-handlers.spec.ts`, `lottery-state.spec.ts`
- `packages/core/src/rewards/rewards.errors.ts`, `rewards.service.ts`, `rewards.module.ts`
- `packages/core/src/transport/http-exception.filter.ts` + `.spec.ts`
- `packages/core/src/rewards/rewards.int-spec.ts`, `rewards.controller.int-spec.ts`
- `packages/core/src/app-runtime/app-runtime.int-spec.ts`
- `packages/core/src/identity/guest-sweep.int-spec.ts`
- `packages/core/src/transport/rooms-lifecycle.controller.int-spec.ts`
- `apps/server/test/lottery.e2e-spec.ts`

## Self-review findings

1. **Поправка к скетчу брифа (шаг 1):** кейс «безпризовой draw» в скетче — `ctx({ settings: {} })` без пула; дефолт `drawPool: []` дал бы DRAW_POOL_EMPTY. Добавлен `drawPool: POOL` — поведение ассерта не меняется.
2. **Отклонение от рулинга C-pre.1** по guest-sweep.int-spec.ts — см. выше; посылка «не трогай» фактически неточна, правка конфигурационная и соответствует принципу рулинга (призовые тесты при 'on').
3. Гейт «ДО findFirst» запинан поведенчески (e2e RF3: несуществующий prizeId при off → PRIZES_DISABLED, не PRIZE_UNKNOWN), не текстовым ассертом кода — устойчиво к рефакторингу.
4. YAGNI: тип `LotterySettings` сохранён (используется e2e-импортом); новых директорий/схем под отложенные возможности не создано; strictObject({}) — зафиксированная словами точка расширения.
5. Тесты проверяют поведение: откат dispatch при гейте (пустой лог), отсутствие списания фонда, не-гейт fulfill/revoke, изоляцию null/призовых пулов — все ассерты на наблюдаемых эффектах.

## Issues / concerns

- Рулинг C-pre.1 о guest-sweep.int-spec.ts стоит уточнить в плане батча C (посылка «только prisma.award.create» неверна для REQ-RWD-013 describe) — во избежание повторного красного прогона у ревьюера.
- Новые describe гейта в rewards int-спеках поднимают по дополнительному testcontainer/app — время прогона test:int выросло незначительно (~+15 c).
