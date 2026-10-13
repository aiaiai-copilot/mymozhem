### Task 7: prize_mode-гейт + lottery v2

**REQ:** REQ-RWD-002b (победитель без сущности приза), REQ-RWD-014 (verified-ветка приостановлена и удалена), REQ-RWD-009 (fulfill/revoke вне гейта), REQ-DEV-007 (аддитивная эволюция payload'ов), REQ-SEC-006 (типизированный PRIZES_DISABLED).

**Files:**
- Modify: `packages/core/src/rewards/rewards.errors.ts` (+= `PrizesDisabledError`), `rewards.service.ts` (конструктор += config; гейты в `createPrize` и `awardPrize`), `rewards.module.ts` (imports ConfigModule, если отсутствует)
- Modify: `packages/core/src/transport/http-exception.filter.ts` (+= `PRIZES_DISABLED: 403`) + спек
- Modify: `packages/core/src/app-runtime/app-runtime.int-spec.ts:645` (ручное конструирование RewardsService += TEST_CONFIG)
- Modify: `packages/app-lottery/src/lottery-events.ts`, `lottery-settings.ts`, `lottery-handlers.ts`, `lottery-state.ts`, `lottery-manifest.ts` (версия 2)
- Modify: `packages/app-lottery/src/lottery-manifest.contract.spec.ts`, `lottery-handlers.spec.ts`, `lottery-state.spec.ts`
- Modify: `apps/server/test/lottery.e2e-spec.ts` (LOTTERY_SETTINGS без drawEligibility; verified-сценарий строки ~352 — удалить; += безпризовой сценарий)
- Modify: `packages/core/src/transport/rooms-lifecycle.controller.int-spec.ts:37` (локальная схема settings без drawEligibility)
- Modify: `packages/core/src/rewards/rewards.int-spec.ts`, `rewards.controller.int-spec.ts` (+= гейт-кейсы)

**Interfaces:**
- Produces: `PrizesDisabledError extends ContractError` (wire `PRIZES_DISABLED`, 403); `LOTTERY_MANIFEST_VERSION = 2`; `drawRunPayload.prizeId?: string`; `drawCompletedPayload.prizeId: string | null`; `LotteryState.draws[*].prizeId: string | null`; `lotterySettingsSchema` = `z.strictObject({})`.

- [ ] **Step 1: Падающие тесты лотереи v2.** `lottery-manifest.contract.spec.ts`: убрать кейсы drawEligibility (61–85), версия манифеста 2; `lottery-handlers.spec.ts`:

```ts
it('безпризовой draw: draw.completed с prizeId=null, БЕЗ эффекта award.prize (REQ-RWD-002b)', () => {
  const result = handleLotteryPublish(ctx({ settings: {} }), 'draw.run', { drawId: UUID1 });
  const completed = result.commits.find((c) => c.shortName === 'draw.completed');
  expect(completed?.payload).toMatchObject({ drawId: UUID1, prizeId: null });
  expect(result.effects).toEqual([]);
});
it('winner-exclusion по ключу null: победитель безпризового розыгрыша вне пула следующего безпризового (решение §0.4)', () => {
  // state.draws = { d0: { prizeId: null, winnerId: P1 } }; pool [P1, P2] → победитель P2
});
it('безпризовые и призовые пулы победителей не пересекаются: приз X не исключает безпризового победителя', () => {
  // state.draws = { d0: { prizeId: null, winnerId: P1 } }; draw.run с prizeId → P1 остаётся в пуле
});
it('replay безпризового drawId: re-emit прежнего результата с prizeId=null, без эффекта', ...);
it('настройка drawEligibility отсутствует: parse({ drawEligibility: 'verified' }) → ZodError (strict)', () => {
  expect(lotterySettingsSchema.safeParse({ drawEligibility: 'verified' }).success).toBe(false);
});
```

- [ ] **Step 2: Реализация лотереи v2**

`lottery-events.ts`:

```ts
export const drawRunPayload = z.strictObject({
  drawId: z.uuid(),
  // ADR-012 §4 / REQ-RWD-002b: розыгрыш без сущности приза — «выбор победителя».
  prizeId: z.uuid().optional(),
});
export const drawCompletedPayload = z.strictObject({
  drawId: z.uuid(),
  prizeId: z.uuid().nullable(),
  winnerId: z.uuid(),
});
```

`lottery-settings.ts` — схема пустеет (verified-ветка удалена, решение §0.6):

```ts
// ADR-012: draw_eligibility удалена (verified-ветка REQ-RWD-014 приостановлена —
// REGISTERED только организатор). Схема сохраняется как точка расширения
// appSettings лотереи; strict — посторонние ключи отклоняются.
export const lotterySettingsSchema = z.strictObject({});
```

`lottery-handlers.ts` — тело после идемпотентности:

```ts
const prizeId = command.prizeId ?? null;
// Прежние победители ЭТОГО приза вне пула; безпризовый розыгрыш исключает
// прежних безпризовых победителей (ключ null, решение §0.4).
const previousWinners = new Set(
  Object.values(ctx.state.draws)
    .filter((d) => d.prizeId === prizeId)
    .map((d) => d.winnerId),
);
const pool = ctx.drawPool.filter((e) => !previousWinners.has(e.identityId));
if (pool.length === 0) throw new AppRejection('DRAW_POOL_EMPTY', 'draw pool is empty');
const winnerId = pool[ctx.randomInt(pool.length)].identityId;
return {
  commits: [
    { shortName: 'draw.run', payload: command, visibility: 'public', actor: 'publisher' },
    { shortName: 'draw.completed', payload: { drawId: command.drawId, prizeId, winnerId }, visibility: 'public', actor: 'server' },
  ],
  // Эффект списания фонда — только при реальном призе; безпризовый draw
  // юридического факта выигрыша не создаёт (ADR-012 §4).
  effects: prizeId ? [{ kind: 'award.prize', prizeId, winnerId }] : [],
};
```

(Ветка settings/verified и `lotterySettingsSchema.parse(ctx.settings)` удаляются; replay-блок уже переизлучает `existing.prizeId` — тип расширяется до nullable.)

`lottery-state.ts`: `draws: Readonly<Record<string, { readonly prizeId: string | null; readonly winnerId: string }>>`.
`lottery-manifest.ts`: `LOTTERY_MANIFEST_VERSION = 2` с комментарием «v2 (ADR-012): prizeId необязателен, draw_eligibility удалена».

- [ ] **Step 3: Прогон лотереи** — `pnpm --filter @mymozhem/app-lottery test && pnpm --filter @mymozhem/app-lottery build` → PASS.

- [ ] **Step 4: Падающие тесты гейта prize_mode** — `rewards.int-spec.ts`:

```ts
describe('prize_mode (ADR-012 §4, решение §0.3)', () => {
  it('off: createPrize → PRIZES_DISABLED', async () => {
    await expect(rewards.createPrize(roomId, organizerId, { name: 'X', quantity: 1 }))
      .rejects.toMatchObject({ code: 'PRIZES_DISABLED' });
  });
  it('on: createPrize работает (конфиг с PRIZE_MODE: on)', ...);
  it('off: award.prize effect отклонён PRIZES_DISABLED, award НЕ создан, quantity не списан', ...);
  it('off: fulfill/revoke существующего award НЕ гейтятся (урегулирование, REQ-RWD-009)', ...);
});
```

(Спеки конструируют RewardsService вручную/через testing-модуль — конфиг подаётся с `PRIZE_MODE: 'off' | 'on'` явно; TEST_CONFIG дефолт off покрывает первый кейс.)

- [ ] **Step 5: Реализация гейта.** `rewards.errors.ts`:

```ts
// ADR-012 §4: призовой режим выключен конфигурацией (дефолт). Не гейтятся:
// fulfill/revoke/list — урегулирование существующих awards (REQ-RWD-009).
export class PrizesDisabledError extends ContractError {
  constructor() {
    super('PRIZES_DISABLED', 'prize mode is off (ADR-012)');
  }
}
```

`rewards.service.ts`: конструктор += `@Inject(APP_CONFIG') private readonly config: AppConfig` (импорты из `../config/...`); первая строка `createPrize` и `awardPrize`:

```ts
if (this.config.PRIZE_MODE === 'off') throw new PrizesDisabledError();
```

`rewards.module.ts`: убедиться, что `ConfigModule` в imports (APP_CONFIG разрешим). `http-exception.filter.ts`: `STATUS_BY_WIRE_CODE` += `PRIZES_DISABLED: 403` + строка спека. `app-runtime.int-spec.ts:645`: `new RewardsService(db.prisma, membership, eventLog, outbox, TEST_CONFIG)`.

- [ ] **Step 6: e2e лотереи.** `lottery.e2e-spec.ts`: `LOTTERY_SETTINGS` = `{}`; удалить verified-сценарий (~352); добавить сценарий безпризового розыгрыша:

```ts
it('безпризовой розыгрыш: draw.run без prizeId → draw.completed с prizeId=null, award НЕ создан', async () => {
  // активная лотерея, 2 гостя; publish lottery.draw.run { drawId } (без prizeId);
  // ждать draw.completed (prizeId null, winnerId ∈ пулу);
  // GET /rooms/:id/rewards → awards пуст;
  // второй безпризовой draw (новый drawId) → победитель ≠ первому (null-ключ, §0.4).
});
```

Плюс кейс Review Focus 3: `draw.run` с prizeId при prize_mode=off (TEST_CONFIG/стенд по умолчанию off) → ack-ошибка `PRIZES_DISABLED`, в логе нет ни `draw.run`, ни `draw.completed` (откат всего dispatch — эффект до коммитов). Если e2e-стенд бутится с TEST_CONFIG-like env — приз для кейса создать нельзя (createPrize тоже загейчен): prizeId берётся произвольный uuid (awardPrize гейт срабатывает до findFirst — порядок строк гарантирует PRIZES_DISABLED, не PRIZE_UNKNOWN; запинать порядок «гейт ДО findFirst» ассертом кода).

- [ ] **Step 7: Прогоны**

```bash
pnpm --filter @mymozhem/core test:int -- rewards
pnpm --filter @mymozhem/core test:int -- app-runtime
pnpm --filter @mymozhem/server test -- lottery.e2e
pnpm build && pnpm boundary-check && pnpm lint && pnpm typecheck && pnpm test
```

- [ ] **Step 8: Commit**

```bash
git add packages/core packages/app-lottery apps/server
git commit -m "feat: prize_mode-гейт и lottery v2 (ADR-012 §4) — PRIZES_DISABLED на createPrize/award.prize при off; prizeId необязателен, draw_eligibility удалена, winner-exclusion по null-ключу"
```

---

