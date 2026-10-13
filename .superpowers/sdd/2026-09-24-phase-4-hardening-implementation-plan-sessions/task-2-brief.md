### Task 2: tx-aware гард + re-check в транзакции свипа (C-8.1, сторона свипа)

**Закрывает:** REQ-RWD-013 (инвариант приостановки — закрытие окна), REQ-ID-003/014 (свип — без изменений семантики). Дизайн §4 «сторона свипа».

**Files:**
- Modify: `packages/core/src/identity/anonymization-guards.ts`
- Modify: `packages/core/src/rewards/rewards-anonymization.guard.ts`
- Modify: `packages/core/src/identity/guest-sweep.service.ts`
- Modify: `packages/core/src/identity/guest-sweep.int-spec.ts`

**Interfaces:**
- Consumes: ничего нового (SDK Task 1 здесь не нужен).
- Produces: `AnonymizationGuard.hasOpenAwards(tx: Prisma.TransactionClient, identityIds: readonly string[]): Promise<Set<string>>` — **новая сигнатура** (tx-первый параметр); единственная реализация — `RewardsAnonymizationGuard` (PrismaService из конструктора убирается). Поведение `GuestSweepService.sweepExpiredGuests`: при гонке (award закоммичен между первым чеком и re-check) — откат tx, возврат `0`, warn-лог.

- [ ] **Step 1: RED — детерминированный тест гонки в `guest-sweep.int-spec.ts`**

Новый `describe` в конце файла. Ключевой приём: `RacingGuard` на **первом** опросе создаёт AWARDED-награду цели **отдельным соединением** (свип ещё не держит блокировок identity — INSERT коммитится немедленно, воспроизводя «award закоммичен между гард-чеком и коммитом») и отвечает «открытых нет»; на **re-check** делегирует реальному гарду → награда видна → свип обязан откатиться. Сиды — один раз в `beforeAll` (config-токен несёт цель в фабрику гардов; module-level `let` в src запрещён REQ-CORE-004, поэтому цель живёт в describe-скоупе и захватывается замыканием фабрики).

```ts
import type { Prisma } from '@prisma/client';
// ...остальные импорты файла уже есть; PrismaService уже импортирован транзитивно —
// добавить явный: import { PrismaService } from '../prisma/prisma.service';

describe('GuestSweepService — окно гонки C-8.1: re-check откатывает свип', () => {
  const RACE_TARGET = Symbol('RACE_TARGET');
  type RaceTarget = { winnerId: string; roomId: string; prizeId: string };

  class RacingGuard implements AnonymizationGuard {
    private calls = 0;
    constructor(
      private readonly prisma: PrismaService,
      private readonly real: RewardsAnonymizationGuard,
      private readonly target: RaceTarget,
    ) {}
    async hasOpenAwards(tx: Prisma.TransactionClient, ids: readonly string[]): Promise<Set<string>> {
      this.calls += 1;
      if (this.calls === 1) {
        // «Конкурирующий» award — своим соединением, до блокировок свипа.
        await this.prisma.award.create({
          data: {
            roomId: this.target.roomId,
            prizeId: this.target.prizeId,
            winnerId: this.target.winnerId,
            status: 'AWARDED',
            sourceAppId: 'lottery',
          },
        });
        return new Set();
      }
      return this.real.hasOpenAwards(tx, ids);
    }
  }

  let db: TestDb;
  let sweep: GuestSweepService;
  let target: RaceTarget;

  beforeAll(async () => {
    db = await startTestDb();
    const org = await seedIdentity(db.prisma, { email: `org-${randomUUID()}@example.test` });
    const room = await db.prisma.room.create({
      data: { code: randomUUID().slice(0, 8).toUpperCase(), organizerId: org.id },
    });
    const prize = await db.prisma.prize.create({
      data: { roomId: room.id, name: 'Приз гонки', quantityTotal: 1, quantity: 1 },
    });
    const guest = await seedIdentity(db.prisma, { kind: 'GUEST' });
    await db.prisma.$executeRaw`UPDATE identity."Identity" SET "createdAt" = now() - interval '25 hours' WHERE id = ${guest.id}::uuid`;
    target = { winnerId: guest.id, roomId: room.id, prizeId: prize.id };

    const RACE_TOKEN = RACE_TARGET;
    @Global()
    @Module({
      imports: [RewardsModule],
      providers: [
        { provide: RACE_TOKEN, useValue: target },
        {
          provide: ANONYMIZATION_GUARDS,
          useFactory: (prisma: PrismaService, real: RewardsAnonymizationGuard, t: RaceTarget): AnonymizationGuard[] => [
            new RacingGuard(prisma, real, t),
          ],
          inject: [PrismaService, RewardsAnonymizationGuard, RACE_TOKEN],
        },
      ],
      exports: [ANONYMIZATION_GUARDS],
    })
    class TestRaceWiringModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        PrismaModule,
        AppRegistryModule.register([]),
        AppRuntimeModule.register([]),
        MembershipModule,
        RealtimeModule,
        RewardsModule,
        IdentityModule,
        TestRaceWiringModule,
      ],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(TEST_CONFIG)
      .compile();
    await moduleRef.init();
    sweep = moduleRef.get(GuestSweepService);
  }, 120_000);

  afterAll(async () => {
    await db.stop();
  });

  it('award, закоммиченный между гард-чеком и коммитом, откатывает анонимизацию (0, identity не тронута)', async () => {
    const anonymized = await sweep.sweepExpiredGuests();
    expect(anonymized).toBe(0);
    const after = await db.prisma.identity.findUniqueOrThrow({ where: { id: target.winnerId } });
    expect(after.deletedAt).toBeNull(); // свип откачен — REQ-RWD-013 победил
    const award = await db.prisma.award.findFirst({ where: { winnerId: target.winnerId, status: 'AWARDED' } });
    expect(award).not.toBeNull(); // «конкурирующая» награда — на месте
  });
});
```

- [ ] **Step 2: Запустить — RED**

Run: `pnpm --filter @mymozhem/core test:int -- guest-sweep.int-spec`
Expected: FAIL (и по сигнатуре `hasOpenAwards` без tx — TS-ошибки в спеке; поведенчески: текущий свип анонимизирует несмотря на награду). Допустимо сначала увидеть compile-fail — это и есть RED формы «интерфейс не существует».

- [ ] **Step 3: GREEN — интерфейс, реализация, re-check**

`packages/core/src/identity/anonymization-guards.ts` — целиком:

```ts
import type { Prisma } from '@prisma/client';

// Приостановка TTL гостя через hook, не импортом (design 2026-09-10 §5,
// REQ-RWD-001/013): identity объявляет токен; rewards регистрирует guard в
// composition root. Паттерн — по прецеденту onAccessRevoked (membership).
export interface AnonymizationGuard {
  // Возвращает подмножество identityIds с нерешённой наградой (AWARDED).
  // tx — транзакция свипа: внетранзакционное чтение создавало окно гонки C-8.1
  // (award, закоммиченный между гард-чеком и коммитом свипа, оставался невидимым);
  // обе точки опроса (до анонимизации и re-check после) читают через tx вызывающего.
  hasOpenAwards(tx: Prisma.TransactionClient, identityIds: readonly string[]): Promise<Set<string>>;
}

export const ANONYMIZATION_GUARDS = Symbol('ANONYMIZATION_GUARDS');
```

`packages/core/src/rewards/rewards-anonymization.guard.ts` — целиком:

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AnonymizationGuard } from '../identity/anonymization-guards';

// REQ-RWD-013: гость с нерешённой наградой (AWARDED; FULFILLED/REVOKED — решённые)
// не анонимизируется до разрешения — иначе приз осиротеет из-за обнуления имени
// победителя до вручения.
@Injectable()
export class RewardsAnonymizationGuard implements AnonymizationGuard {
  // PrismaService больше не инжектируется (C-8.1, ф.4): чтение строго через tx
  // вызывающего — внетранзакционное чтение создавало окно гонки со свипом.
  async hasOpenAwards(tx: Prisma.TransactionClient, identityIds: readonly string[]): Promise<Set<string>> {
    if (identityIds.length === 0) return new Set();
    const rows = await tx.award.findMany({
      where: { winnerId: { in: [...identityIds] }, status: 'AWARDED' },
      select: { winnerId: true },
    });
    return new Set(rows.map((r) => r.winnerId));
  }
}
```

`packages/core/src/identity/guest-sweep.service.ts`:
- Заменить устаревший комментарий о «гард читает ВНЕ транзакции… принято как риск MVP» на:

```ts
  // Возвращает число анонимизированных identity. Одна транзакция даёт атомарность
  // свипа; C-8.1 (ф.4) закрыто re-check'ом: гард опрашивается дважды ВНУТРИ tx —
  // до анонимизации и после updateMany. READ COMMITTED делает видимым любой award,
  // закоммитившийся до перепроверки (включая тот, чей INSERT ждал нашей
  // FOR NO KEY UPDATE блокировки на identity — FK-проверка Award берёт FOR KEY
  // SHARE, блокировки конфликтуют) → throw откатывает всю tx. Остаточное
  // направление «анонимизирован → награждён» (award коммитится после COMMIT
  // свипа) закрыто гардой identity.deletedAt в RewardsService.awardPrize.
```

- Добавить module-local класс (рядом с импортами, до `@Injectable()`):

```ts
// Внутренний сигнал отката при гонке C-8.1: не доменная ошибка, на провод не
// маппится (свип вызывается только планировщиком); ловится в sweepExpiredGuests.
class SweepSuspensionRaceError extends Error {
  constructor(readonly racedCount: number) {
    super(`concurrent award detected during sweep for ${racedCount} identit(ies)`);
    this.name = new.target.name;
  }
}
```

- Тело `sweepExpiredGuests` — обёрнуть `$transaction` в try/catch и добавить re-check:

```ts
  async sweepExpiredGuests(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.GUEST_TTL * 1000);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const candidates = await tx.identity.findMany({
          where: { kind: 'GUEST', deletedAt: null, createdAt: { lt: cutoff } },
          select: { id: true },
        });
        if (candidates.length === 0) return 0;
        const ids = candidates.map((c) => c.id);
        const suspended = new Set<string>();
        for (const guard of this.guards) {
          for (const id of await guard.hasOpenAwards(tx, ids)) suspended.add(id);
        }
        const sweepIds = ids.filter((id) => !suspended.has(id));
        if (sweepIds.length === 0) return 0;
        const anonymized = await tx.identity.updateMany({
          where: { id: { in: sweepIds }, deletedAt: null },
          data: { displayName: null, email: null, deletedAt: now },
        });
        await tx.session.updateMany({
          where: { identityId: { in: sweepIds }, revokedAt: null },
          data: { revokedAt: now },
        });
        // C-8.1: re-check после updateMany — award, закоммитившийся между первым
        // чеком и этой строкой, здесь виден → откат всей tx (анонимизация и
        // отзыв сессий отменяются).
        const raced = new Set<string>();
        for (const guard of this.guards) {
          for (const id of await guard.hasOpenAwards(tx, sweepIds)) raced.add(id);
        }
        if (raced.size > 0) throw new SweepSuspensionRaceError(raced.size);
        this.logger.log(`guest sweep: anonymized ${anonymized.count}, suspended ${suspended.size}`);
        return anonymized.count;
      });
    } catch (err) {
      if (err instanceof SweepSuspensionRaceError) {
        // Ожидаемый исход гонки, не алерт: следующий тик CLEANUP_INTERVAL
        // обработает гостя как приостановленного (award уже виден первому чеку).
        this.logger.warn(`guest sweep rolled back: concurrent award for ${err.racedCount} identit(ies) (C-8.1)`);
        return 0;
      }
      throw err;
    }
  }
```

(Ветка «свип без гардов» и существующие тесты не меняются — `this.guards` по-прежнему `@Optional()` с дефолтом `[]`.)

- [ ] **Step 4: Запустить — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- guest-sweep.int-spec`
Expected: PASS все три describe (включая новый гоночный).

- [ ] **Step 5: Прогон затронутых лан и гейтов**

Run: `pnpm --filter @mymozhem/core test:int -- rewards.int-spec` (гард без конструктора — DI собирается) → PASS.
Run: `pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core lint`
Expected: всё зелёное.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/identity/anonymization-guards.ts packages/core/src/rewards/rewards-anonymization.guard.ts packages/core/src/identity/guest-sweep.service.ts packages/core/src/identity/guest-sweep.int-spec.ts
git commit -m "fix(identity): close sweep race window C-8.1 — tx-aware guard + re-check rollback"
```

---

