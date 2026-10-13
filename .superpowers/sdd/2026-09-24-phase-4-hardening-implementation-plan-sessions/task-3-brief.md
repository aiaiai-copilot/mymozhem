### Task 3: Award-гарда identity.deletedAt (C-8.1, сторона award)

**Закрывает:** остаточное направление гонки «анонимизирован → награждён» (дизайн §4 «сторона award»; Review Focus 4).

**Files:**
- Modify: `packages/core/src/rewards/rewards.errors.ts`
- Modify: `packages/core/src/rewards/rewards.service.ts`
- Modify: `packages/core/src/transport/http-exception.filter.ts`
- Modify: `packages/core/src/transport/http-exception.filter.spec.ts`
- Modify: `packages/core/src/rewards/rewards.int-spec.ts`

**Interfaces:**
- Consumes: `'IDENTITY_ANONYMIZED'` из `CONTRACT_ERROR_CODES` (Task 1, SDK 1.8.0 — после правок SDK выполнен `pnpm --filter @mymozhem/sdk build`, core резолвит dist).
- Produces: `IdentityAnonymizedError extends ContractError` (rewards.errors); `awardPrize` бросает его ДО insert'а и декремента; HTTP-маппинг 409.

- [ ] **Step 1: RED — тест в `rewards.int-spec.ts`**

В основной describe файла (рядом с кейсами awardPrize; хелперы `seedPrize`/`outbox` уже есть в файле):

```ts
it('award.prize по анонимизированному гостю отклоняется IDENTITY_ANONYMIZED; фонд и таблица не тронуты (C-8.1)', async () => {
  const { room, prize } = await seedPrize(1);
  const swept = await seedIdentity(db.prisma, { kind: 'GUEST' });
  await db.prisma.identity.update({ where: { id: swept.id }, data: { deletedAt: new Date() } });

  await expect(
    outbox.run((tx) =>
      rewards.executeEffects(tx, room.id, 'lottery', [
        { kind: 'award.prize', prizeId: prize.id, winnerId: swept.id },
      ]),
    ),
  ).rejects.toMatchObject({ code: 'IDENTITY_ANONYMIZED' });

  expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(1);
  expect(await db.prisma.award.count({ where: { prizeId: prize.id } })).toBe(0);
});
```

(Имена локальных хелперов/переменных сверить с фактическим файлом — `seedPrize`, `rewards`, `outbox`, `db` существуют в нём; при расхождении поправить привязку, не смысл.)

- [ ] **Step 2: RED — HTTP-маппинг в `http-exception.filter.spec.ts`**

В таблицу `cases` добавить ряд (рядом с rewards-кодами):

```ts
['identity anonymized', new ContractError('IDENTITY_ANONYMIZED', 'x'), 409, 'IDENTITY_ANONYMIZED'],
```

Run: `pnpm --filter @mymozhem/core test:int -- rewards.int-spec` → FAIL (сейчас award вставится); `pnpm --filter @mymozhem/core test -- http-exception.filter.spec` → FAIL (нет маппинга → INTERNAL_ERROR/500).

- [ ] **Step 3: GREEN — ошибка, гарда, маппинг**

`packages/core/src/rewards/rewards.errors.ts` — добавить:

```ts
// C-8.1 (ф.4): награждение анонимизированной (свип) или неизвестной identity
// отклонено — приз осиротел бы (displayName уже NULL, вручать некому).
export class IdentityAnonymizedError extends ContractError {
  constructor(identityId: string) {
    super('IDENTITY_ANONYMIZED', `identity ${identityId} is anonymized or unknown — prize would be orphaned`);
  }
}
```

`packages/core/src/rewards/rewards.service.ts` — импортировать `IdentityAnonymizedError`; в `awardPrize` сразу после проверки `prize` и ДО raw-INSERT'а:

```ts
    // C-8.1 (ф.4): победитель не должен быть анонимизирован/отсутствовать. Чтение
    // в той же tx; FK-проверка Award ниже берёт FOR KEY SHARE на identity и
    // конфликтует с updateMany свипа (FOR NO KEY UPDATE) — пути сериализуются,
    // и проигравший гонку видит финальное состояние этой проверкой. Отказ —
    // типизированный, откатывает tx без списания фонда (организатор перерозыгрышит).
    const winner = await tx.identity.findUnique({ where: { id: winnerId }, select: { deletedAt: true } });
    if (winner === null || winner.deletedAt !== null) {
      throw new IdentityAnonymizedError(winnerId);
    }
```

`packages/core/src/transport/http-exception.filter.ts` — в `STATUS_BY_WIRE_CODE` после `REWARD_ALREADY_RESOLVED: 409,`:

```ts
  // Фаза 4 (C-8.1): гонка свип/розыгрыш проиграна награждением — как прочие 409 конфликта состояния.
  IDENTITY_ANONYMIZED: 409,
```

Примечание для исполнителя: `award.points` (PointsGrant) гардой НЕ покрывается — осознанно (ledger без вручения; дизайн §4 говорит только про awardPrize).

- [ ] **Step 4: Запустить — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- rewards.int-spec`
Run: `pnpm --filter @mymozhem/core test -- http-exception.filter.spec`
Expected: PASS оба.

- [ ] **Step 5: Ланы и гейты**

Run: `pnpm --filter @mymozhem/core test:int -- guest-sweep.int-spec` (регрессия связки) → PASS; `pnpm build && pnpm run boundary-check` → зелёные.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/rewards/rewards.errors.ts packages/core/src/rewards/rewards.service.ts packages/core/src/transport/http-exception.filter.ts packages/core/src/transport/http-exception.filter.spec.ts packages/core/src/rewards/rewards.int-spec.ts
git commit -m "fix(rewards): refuse prize award to anonymized identity (C-8.1) — IDENTITY_ANONYMIZED"
```

---

