### Task 4: Prisma-схема rewards + миграция + автотесты + параметр CLEANUP_INTERVAL

**Files:**
- Modify: `packages/core/prisma/schema.prisma` (schemas list + 3 модели + enum + обратные связи)
- Create: `packages/core/prisma/migrations/<timestamp>_rewards_schema/migration.sql` (рукописные CHECK + частичный индекс)
- Test: `packages/core/src/rewards/rewards-schema.int-spec.ts` (новый)
- Modify: `packages/core/src/config/config.schema.ts:20` (CLEANUP_INTERVAL), `packages/core/src/config/config.schema.spec.ts`
- Modify: `packages/core/src/testing/test-config.ts` (TEST_CONFIG += CLEANUP_INTERVAL)

**Interfaces:**
- Produces: Prisma-модели `prize`, `award`, `pointsGrant` (client API `prisma.prize/.award/.pointsGrant`), enum `AwardStatus` (`'AWARDED' | 'FULFILLED' | 'REVOKED'` — uppercase в БД, БЕЗ `@map`, под дословный SQL дизайна §3); частичный индекс `"Award_single_active_winner_per_prize_key"`; CHECK `"Prize_quantity_nonnegative"`; конфиг-ключ `CLEANUP_INTERVAL` (секунды, 300…86400, дефолт 3600) — потребляет Task 8 (свип).

**REQ:** REQ-RWD-002a/b (Award.prizeId nullable), REQ-RWD-003 (частичный индекс), REQ-RWD-010 (CHECK + декремент), REQ-DEV-006 (SQL-миграция + автотест), REQ-ID-010 (cleanup_interval — §4 пакета).

- [ ] **Step 1: Failing test — наличие индекса и CHECK (REQ-DEV-006)**

`packages/core/src/rewards/rewards-schema.int-spec.ts` (по образцу `packages/core/src/identity/identity-schema.int-spec.ts:21-34`; харнесс `startTestDb` из `packages/core/src/testing/postgres.testcontainer.ts`):

```typescript
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';

describe('rewards schema (REQ-DEV-006, REQ-RWD-003/010)', () => {
  let db: TestDb;
  beforeAll(async () => { db = await startTestDb(); }, 120_000);
  afterAll(async () => { await db.stop(); });

  it('has the partial unique index on active awards', async () => {
    const rows = await db.prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'rewards' AND indexname = 'Award_single_active_winner_per_prize_key'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/^CREATE UNIQUE INDEX/);
    expect(rows[0].indexdef).toContain('"roomId"');
    expect(rows[0].indexdef).toContain('"prizeId"');
    expect(rows[0].indexdef).toContain('"winnerId"');
    expect(rows[0].indexdef).toContain("'AWARDED'");
    expect(rows[0].indexdef).toContain("'FULFILLED'");
  });

  it('has the CHECK quantity >= 0 on Prize (REQ-RWD-010)', async () => {
    const rows = await db.prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conname = 'Prize_quantity_nonnegative' AND connamespace = 'rewards'::regnamespace
    `;
    expect(rows).toHaveLength(1);
  });

  // Поведенческие кейсы индекса: сиды комнаты/приза/победителя.
  // Полный набор полей Room/Prize/Award сверить с schema.prisma при исполнении.
  async function seedRoomPrizeWinner() {
    const org = await seedIdentity(db.prisma, { email: 'org@example.test' });
    const winner = await seedIdentity(db.prisma, { kind: 'GUEST', displayName: 'Гость' });
    const room = await db.prisma.room.create({ data: { code: 'RWD12345', organizerId: org.id } });
    const prize = await db.prisma.prize.create({
      data: { roomId: room.id, name: 'Приз', quantityTotal: 2, quantity: 2 },
    });
    return { room, prize, winner };
  }

  it('blocks a second active award of the same prize to the same winner; revoke frees the slot; fulfilled does not', async () => {
    const { room, prize, winner } = await seedRoomPrizeWinner();
    const first = await db.prisma.award.create({
      data: { roomId: room.id, prizeId: prize.id, winnerId: winner.id, sourceAppId: 'lottery' },
    });
    // Дубль по активной записи — конфликт индекса.
    await expect(
      db.prisma.award.create({
        data: { roomId: room.id, prizeId: prize.id, winnerId: winner.id, sourceAppId: 'lottery' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    // Отзыв освобождает место.
    await db.prisma.award.update({ where: { id: first.id }, data: { status: 'REVOKED', revokedAt: new Date() } });
    const second = await db.prisma.award.create({
      data: { roomId: room.id, prizeId: prize.id, winnerId: winner.id, sourceAppId: 'lottery' },
    });
    // FULFILLED — нет: слот по-прежнему занят.
    await db.prisma.award.update({ where: { id: second.id }, data: { status: 'FULFILLED', fulfilledAt: new Date() } });
    await expect(
      db.prisma.award.create({
        data: { roomId: room.id, prizeId: prize.id, winnerId: winner.id, sourceAppId: 'lottery' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('CHECK rejects a negative quantity and the guarded decrement stops at zero', async () => {
    const { prize } = await seedRoomPrizeWinner();
    await expect(
      db.prisma.$executeRaw`UPDATE rewards."Prize" SET quantity = -1 WHERE id = ${prize.id}::uuid`,
    ).rejects.toMatchObject({ code: 'P2010' }); // SQLSTATE 23514 check_violation (форма adapter-pg — HANDOFF)
    const zero = await db.prisma.prize.update({ where: { id: prize.id }, data: { quantity: 0 } });
    const n = await db.prisma.$executeRaw`UPDATE rewards."Prize" SET quantity = quantity - 1 WHERE id = ${zero.id}::uuid AND quantity >= 1`;
    expect(n).toBe(0);
  });
});
```

(Если `seedIdentity` не принимает `kind`/`displayName` — свериться с `testing/seed-identity.ts` и передать поддерживаемые поля; GUEST-сид по умолчанию уже может существовать.)

Также failing unit на конфиг — `config.schema.spec.ts`:

```typescript
it('accepts CLEANUP_INTERVAL within the §4 range and defaults to 1 hour', () => {
  const base = validEnv(); // существующий хелпер валидного env в спеке
  expect(loadConfig({ ...base, CLEANUP_INTERVAL: '600' }).CLEANUP_INTERVAL).toBe(600);
  expect(loadConfig(base).CLEANUP_INTERVAL).toBe(3600);
  expect(() => loadConfig({ ...base, CLEANUP_INTERVAL: '60' })).toThrow(); // < 5 мин
  expect(() => loadConfig({ ...base, CLEANUP_INTERVAL: '90000' })).toThrow(); // > 24 ч
});
```

(Имя хелпера валидного env сверить со спеком; если его нет — собрать минимальный валидный env по соседним кейсам.)

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test -- config.schema` и `pnpm --filter @mymozhem/core test:int -- rewards-schema`
Expected: FAIL (конфиг-ключа нет — typecheck/throw; таблицы rewards не существуют).

- [ ] **Step 3: Implement — schema.prisma**

В datasource-блоке (строки 5-8) добавить `"rewards"` в `schemas = [...]`. В конец файла:

```prisma
// === Фаза 3: rewards (design 2026-09-10 §3) ===

model Prize {
  id            String   @id @default(uuid()) @db.Uuid
  roomId        String   @db.Uuid
  name          String
  quantityTotal Int // исходный фонд, для «раздано X из Y»
  quantity      Int    // остаток; CHECK (quantity >= 0) — рукописной миграцией (REQ-RWD-010)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  room   Room    @relation(fields: [roomId], references: [id], onDelete: Restrict)
  awards Award[]

  @@schema("rewards")
}

// БЕЗ @map: значения в БД uppercase, под дословный SQL частичного индекса
// (design §3; прецедент MemberRole).
enum AwardStatus {
  AWARDED
  FULFILLED
  REVOKED

  @@schema("rewards")
}

model Award {
  id          String      @id @default(uuid()) @db.Uuid
  roomId      String      @db.Uuid
  prizeId     String?     @db.Uuid // REQ-RWD-002b: победитель без сущности приза
  winnerId    String      @db.Uuid
  status      AwardStatus @default(AWARDED)
  sourceAppId String // 'lottery', 'quiz'
  createdAt   DateTime    @default(now())
  fulfilledAt DateTime?
  revokedAt   DateTime?

  room   Room     @relation(fields: [roomId], references: [id], onDelete: Restrict)
  prize  Prize?   @relation(fields: [prizeId], references: [id], onDelete: Restrict)
  winner Identity @relation(fields: [winnerId], references: [id], onDelete: Restrict)

  // Единичность победителя по активным записям — частичный уникальный индекс
  // "Award_single_active_winner_per_prize_key", рукописной миграцией (REQ-RWD-003,
  // REQ-DEV-006). NULL prizeId не конфликтует (SQL NULLs distinct) — осознанно.
  @@index([roomId])
  @@schema("rewards")
}

model PointsGrant {
  id          String   @id @default(uuid()) @db.Uuid
  roomId      String   @db.Uuid
  identityId  String   @db.Uuid
  points      Int // только положительные в MVP (принуждается appEffectSchema)
  reason      String? // 'quiz.round', …
  sourceAppId String
  createdAt   DateTime @default(now())

  room     Room     @relation(fields: [roomId], references: [id], onDelete: Restrict)
  identity Identity @relation(fields: [identityId], references: [id], onDelete: Restrict)

  // Агрегат «баллы участника» — проекция по ledger'у, не хранимый счётчик.
  @@index([roomId, identityId])
  @@schema("rewards")
}
```

Обратные связи: в модель `Room` добавить `prizes Prize[]`, `awards Award[]`, `pointsGrants PointsGrant[]`; в модель `Identity` — `awardsWon Award[]`, `pointsGrants PointsGrant[]`. (Отношения разных моделей к Room/Identity конфликтов имён не создают; если Prisma потребует именованных relation — назвать и зафиксировать отклонение в леджере.)

- [ ] **Step 4: Implement — миграция с рукописными частями**

Из корня репозитория (Prisma 7 CLI; нужна dev-БД в `DATABASE_URL`):

```bash
DATABASE_URL=<dev-db-url> pnpm exec prisma migrate dev --name rewards_schema
```

В сгенерированный `migration.sql` ДОБАВИТЬ в конец (рукописные части, прецеденты `20260722151900_identity_seam/migration.sql:24-26` и `20260723090841_room_app_config/migration.sql`):

```sql
-- REQ-RWD-010: ограниченность призового фонда — DB-инвариант (рукописной CHECK;
-- preview-функцию Prisma partialIndexes/checkConstraints НЕ использовать, REQ-DEV-006).
ALTER TABLE rewards."Prize" ADD CONSTRAINT "Prize_quantity_nonnegative" CHECK (quantity >= 0);

-- REQ-RWD-003 + REQ-DEV-006: единичность победителя по активным записям.
-- «Активная» = не отозванная: отзыв освобождает место (приз можно переразыграть),
-- вручённая — нет. Сетевой повтор того же награждения конфликтует по индексу →
-- типизированный no-op в RewardsService (Task 5).
CREATE UNIQUE INDEX "Award_single_active_winner_per_prize_key"
  ON rewards."Award" ("roomId", "prizeId", "winnerId")
  WHERE "status" IN ('AWARDED', 'FULFILLED');
```

Затем `DATABASE_URL=<dev-db-url> pnpm exec prisma migrate reset --skip-seed` НЕ нужен — достаточно повторного `migrate dev` (он применит доработанную миграцию после `--create-only`-цикла; если CLI уже применил миграцию до правки — откатить её в dev-БД и прогнать заново, либо использовать форму `migrate dev --create-only` → правка SQL → `migrate dev`). Зафиксировать выбранную последовательность в леджере.

`DATABASE_URL=<dev-db-url> pnpm exec prisma generate` — регенерация клиента (CLI не всегда регенерирует сам — HANDOFF).

- [ ] **Step 5: Implement — CLEANUP_INTERVAL**

`config.schema.ts` после `GUEST_TTL` (строка 20):

```typescript
  // §4: cleanup_interval — 1 ч, 5 мин … 24 ч (секунды). Интервал регламентных
  // джоб (REQ-ID-010); фаза 3 — свип анонимизации гостей (REQ-ID-003/014, Task 8).
  CLEANUP_INTERVAL: z.coerce.number().int().min(300).max(86_400).default(3_600),
```

`testing/test-config.ts`: в `TEST_CONFIG` добавить `CLEANUP_INTERVAL: 3_600,` (структурно полный AppConfig — без ключа упадёт typecheck, это ожидаемый сигнал).

- [ ] **Step 6: Run — GREEN**

Run: `pnpm --filter @mymozhem/core test -- config.schema && pnpm --filter @mymozhem/core test:int -- rewards-schema`
Expected: PASS (testcontainers поднимает Postgres, `migrate deploy` применяет новую миграцию). Затем `pnpm build && pnpm --filter @mymozhem/core test:int` — вся лана зелёная.

- [ ] **Step 7: Commit**

```bash
git add packages/core/prisma packages/core/src/config packages/core/src/testing packages/core/src/rewards
git commit -m "feat(core): схема rewards — Prize/Award/PointsGrant, CHECK фонда, частичный индекс единичности, CLEANUP_INTERVAL

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

