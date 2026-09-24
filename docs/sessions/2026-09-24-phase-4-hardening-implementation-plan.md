# Фаза 4 — харднинг-срез: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть REQ-OPS-004 полным текстом (структурные логи с корреляцией + `/metrics` с 4 метриками) и окно гонки свипа C-8.1 (re-check в tx + award-гарда), зафиксировать закрытие REQ-SEC-008 без нового кода.

**Architecture:** Новый модуль `core/observability` (MetricsService поверх prom-client + pino-конфигурация поверх nestjs-pino) — листовой, импортируется доменными модулями. Метрики инструментируются в единственных воронках: SubscriptionRegistry.add/remove (gauge), EventOutbox.run (счётчик ошибок фиксации), RealtimeGateway fanOut/subscribe (гистограммы) — без размазывания по вызывающим. C-8.1 закрывается повторным гард-чеком в tx свипа + гардой `identity.deletedAt` в awardPrize (без serializable).

**Tech Stack:** NestJS 11 (Fastify), Prisma 7.8 (adapter-pg), zod 4, prom-client ^15, nestjs-pino ^4 / pino ^9 / pino-http ^10, jest 29 (unit/int), apps/server e2e.

**Spec:** `docs/sessions/2026-09-24-phase-4-hardening-design.md` (§0 — решения владельца; §7 — критерии выхода для exit-аудита Task 10).

**Батчи (конвенция владельца):** батч A = Tasks 1–3 (C-8.1), батч B = Tasks 4–6 (метрики), батч C = Tasks 7–9 (логи), батч D = Task 10 (exit-аудит, с финревью батча C). Каждый батч — новой сессией; в конце батча — финревью + HANDOFF + стоп.

## Global Constraints

- Node >= 24, pnpm 11, **один lockfile** (REQ-DEV-002) — зависимости только через `pnpm add`, никаких ручных правок lockfile.
- Core не импортирует fastify эксплицитно — структурные адаптеры (`ReplyLike`-прецедент `http-exception.filter.ts`).
- Импортёры `nestjs-pino`/`pino`/`pino-http`/`prom-client` — только `core/src/observability`, barrel `core/src/index.ts` и `apps/server/src/main.ts` (boundary-правило Task 6).
- REQ-CORE-004: никакого мутабельного module-level состояния в `packages/**/src` (состояние — поля экземпляров; eslint-гард активен).
- Postgres-ловушки репозитория: `$queryRaw` не десериализует void-выражения (только `$executeRaw`); raw-ошибки — `P2010` + подстроки; catch unique-violation ВНУТРИ tx отравляет её (25P02) — не добавлять in-tx try/catch на unique.
- Prisma 7 CLI — только из корня репозитория (`pnpm exec prisma …`).
- Формы прогонов: unit — `pnpm --filter @mymozhem/core test -- <файл>`; int — `pnpm --filter @mymozhem/core test:int -- <файл>` (без `--` после; Docker/OrbStack запущен, ~8–10 с на файл); e2e — сначала `pnpm build`, затем `pnpm --filter @mymozhem/server test -- <файл>`. Фильтр проверять на >0 матчей.
- После правок SDK: `pnpm --filter @mymozhem/sdk build` (core резолвит sdk из dist); после правок core: `pnpm build` перед e2e apps/server.
- CI-порядок: build → boundary-check; guardrails — `pnpm run guardrails`.
- Тесты пишутся первыми (TDD), RED показывается до GREEN.
- Идентификатор актора — только из аутентифицированного контекста (REQ-RT-009); логи не содержат payload'ов событий, токенов, кук (дух REQ-SEC-009).
- SDK — лист (sdk-is-leaf); app-пакеты не трогаем вообще.

## Review Focus

1. **Рассинхрон gauge при catch-путях subscribe** (join-first дизайн: registry.add до чтения лога, remove в 3 местах — disconnect, mid-subscribe disconnect, catch): инкремент/декремент обязан жить внутри `SubscriptionRegistry.add/remove`, а не в gateway — тогда любой путь очистки парный по построению. Пин — Task 5, шаг 1 (unit add/remove/remove-missing).
2. **Stale-серии gauge:** завершённые комнаты копят серии `mymozhem_active_connections{roomId=…}` со значением 0. `connectionRemoved` при нуле удаляет серию (`gauge.remove`). Пин — Task 4, шаг 1 (тест «серия исчезает после последнего disconnect»).
3. **Skew часов БД↔app:** `publish→deliver` считается по `LogEvent.recordedAt` (DB now()) против `Date.now()` приложения — на разных машинах возможны отрицательные значения. `observePublishToDeliver` зажимает в 0. Пин — Task 4, шаг 1 (тест с отрицательным значением).
4. **Остаточное направление гонки «анонимизирован → награждён»** закрывается НЕ re-check'ом (award-INSERT ждёт блокировки свипа и коммитится после его COMMIT), а award-гардой Task 3 — опустить Task 3 нельзя, re-check без неё не полон. Пин — Task 3, шаг 1.
5. **Redact pino покрывает только перечисленные пути:** тела запросов и Set-Cookie не логируются нормой дизайна (autoLogging не логирует body), но если кто-то добавит логирование заголовков ответа — утечёт refresh-кука. Пин — Task 9, шаг 2 (e2e: строка лога не содержит значения authorization/cookie).

---

### Task 1: SDK 1.8.0 — код ошибки IDENTITY_ANONYMIZED

**Закрывает:** контрактную часть C-8.1 (дизайн §4: новый код в `CONTRACT_ERROR_CODES`, минор SDK). Потребители — Task 3 (rewards) и HTTP-фильтр.

**Files:**
- Modify: `packages/sdk/src/errors/error-codes.ts`
- Modify: `packages/sdk/src/errors/error-codes.spec.ts`
- Modify: `packages/sdk/package.json` (version)
- Modify: `packages/sdk/src/contract-version.ts` (CONTRACT_VERSION)

**Interfaces:**
- Consumes: ничего из других задач.
- Produces: `CONTRACT_ERROR_CODES` включает `'IDENTITY_ANONYMIZED'` (перед `'INTERNAL_ERROR'`); `CONTRACT_VERSION = '1.8.0'`; `package.json` version `1.8.0`.

- [ ] **Step 1: RED — обновить спеки под новый код и версию**

В `packages/sdk/src/errors/error-codes.spec.ts`:
- В тест «exports exactly the codes named by the design §8» добавить `'IDENTITY_ANONYMIZED',` в ожидаемый массив **перед** `'INTERNAL_ERROR'`.
- Добавить ряд после существующего `it.each` для phase-3 кодов:

```ts
it.each(['IDENTITY_ANONYMIZED'] as const)('accepts phase-4 code %s', (code) => {
  expect(contractErrorCodeSchema.safeParse(code).success).toBe(true);
});
```

- [ ] **Step 2: Запустить — убедиться в RED**

Run: `pnpm --filter @mymozhem/core test -- errors/error-codes.spec.ts` — нет, спека живёт в SDK:
Run: `pnpm --filter @mymozhem/sdk test -- errors/error-codes.spec.ts`
Expected: FAIL — `'IDENTITY_ANONYMIZED'` отсутствует в `CONTRACT_ERROR_CODES`.

- [ ] **Step 3: GREEN — добавить код и поднять версии**

`packages/sdk/src/errors/error-codes.ts` — в массив `CONTRACT_ERROR_CODES` перед `'INTERNAL_ERROR'`:

```ts
  // Фаза 4 (C-8.1): award по анонимизированной/неизвестной identity отклонён —
  // приз не должен осиротеть (дизайн 2026-09-24 §4).
  'IDENTITY_ANONYMIZED',
```

`packages/sdk/src/contract-version.ts`: `export const CONTRACT_VERSION = '1.8.0';`
`packages/sdk/package.json`: `"version": "1.8.0"`.

- [ ] **Step 4: Прогон SDK полностью + build**

Run: `pnpm --filter @mymozhem/sdk test && pnpm --filter @mymozhem/sdk build`
Expected: PASS (включая contract-version.spec — pkg.version ≡ CONTRACT_VERSION сверяется автоматически) + build без ошибок.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/errors/error-codes.ts packages/sdk/src/errors/error-codes.spec.ts packages/sdk/package.json packages/sdk/src/contract-version.ts
git commit -m "feat(sdk): IDENTITY_ANONYMIZED contract error code (C-8.1), SDK 1.8.0"
```

---

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

### Task 4: prom-client + MetricsModule (4 метрики REQ-OPS-004)

**Закрывает:** REQ-OPS-004 (метрики — ядро). Дизайн §3.

**Files:**
- Modify: `packages/core/package.json` (dep `prom-client`)
- Create: `packages/core/src/observability/metrics.service.ts`
- Create: `packages/core/src/observability/metrics.service.spec.ts`
- Create: `packages/core/src/observability/metrics.module.ts`
- Modify: `packages/core/src/index.ts` (barrel-экспорт)

**Interfaces:**
- Consumes: ничего из других задач.
- Produces (потребители — Tasks 5/6):
  - `class MetricsService` с методами: `observePublishToDeliver(visibility: string, seconds: number): void` (клэмп ≥ 0), `observeReplayDuration(level: string, seconds: number): void`, `incCommitError(code: string): void`, `connectionAdded(roomId: string): void`, `connectionRemoved(roomId: string): void`, `readonly contentType: string`, `render(): Promise<string>`.
  - `class MetricsModule` — `@Module({ providers: [MetricsService], exports: [MetricsService] })`.

- [ ] **Step 0: Зависимость**

Run: `pnpm --filter @mymozhem/core add prom-client@^15.1.3`
(Один lockfile — коммитим `pnpm-lock.yaml` вместе с кодом задачи.)

- [ ] **Step 1: RED — unit-спека `metrics.service.spec.ts`**

```ts
import { MetricsService } from './metrics.service';

// REQ-OPS-004: ровно 4 метрики дизайна §3; собственный Registry (не default) —
// спеки не загрязняют друг друга.
describe('MetricsService (REQ-OPS-004)', () => {
  it('экспонирует 4 метрики в Prometheus text format', async () => {
    const m = new MetricsService();
    m.observePublishToDeliver('public', 0.012);
    m.observeReplayDuration('organizer', 0.2);
    m.incCommitError('P2034');
    m.connectionAdded('room-1');

    const text = await m.render();

    expect(text).toContain('mymozhem_publish_to_deliver_seconds_count{visibility="public"} 1');
    expect(text).toContain('mymozhem_replay_duration_seconds_count{level="organizer"} 1');
    expect(text).toContain('mymozhem_event_commit_errors_total{code="P2034"} 1');
    expect(text).toContain('mymozhem_active_connections{roomId="room-1"} 1');
    expect(m.contentType).toContain('text/plain');
  });

  it('gauge: парные add/remove; серия комнаты исчезает при нуле (stale-series гигиена)', async () => {
    const m = new MetricsService();
    m.connectionAdded('room-1');
    m.connectionAdded('room-1');
    m.connectionRemoved('room-1');
    expect(await m.render()).toContain('mymozhem_active_connections{roomId="room-1"} 1');
    m.connectionRemoved('room-1');
    expect(await m.render()).not.toContain('mymozhem_active_connections{roomId="room-1"}');
    // remove без add — не уводит в минус:
    m.connectionRemoved('room-1');
    expect(await m.render()).not.toContain('mymozhem_active_connections{roomId="room-1"}');
  });

  it('publish→deliver зажимается в 0 при skew часов (recordedAt БД впереди Date.now())', async () => {
    const m = new MetricsService();
    m.observePublishToDeliver('public', -5);
    const text = await m.render();
    expect(text).toContain('mymozhem_publish_to_deliver_seconds_count{visibility="public"} 1');
    expect(text).toContain('mymozhem_publish_to_deliver_seconds_sum{visibility="public"} 0');
  });
});
```

Run: `pnpm --filter @mymozhem/core test -- metrics.service.spec` → FAIL (модуля нет).

- [ ] **Step 2: GREEN — `metrics.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

// REQ-OPS-004 (ф.4, дизайн 2026-09-24 §3): 4 метрики наблюдаемости. Собственный
// Registry (не default registry prom-client) — изоляция тестов; состояние —
// поля экземпляра (REQ-CORE-004). Сервис беззависимостный: конструируется и
// вручную в unit-спеках потребителей.
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  private readonly publishToDeliver = new Histogram({
    name: 'mymozhem_publish_to_deliver_seconds',
    help: 'Latency from log-event commit (recordedAt) to live delivery to subscribers',
    labelNames: ['visibility'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  private readonly replayDuration = new Histogram({
    name: 'mymozhem_replay_duration_seconds',
    help: 'Duration of room-log replay during subscribe (log read + snapshot build)',
    labelNames: ['level'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [this.registry],
  });

  private readonly commitErrors = new Counter({
    name: 'mymozhem_event_commit_errors_total',
    help: 'Event-commit transactions rolled back by an untyped failure (typed domain rejections excluded)',
    labelNames: ['code'],
    registers: [this.registry],
  });

  private readonly activeConnections = new Gauge({
    name: 'mymozhem_active_connections',
    help: 'Active realtime subscriptions per room',
    labelNames: ['roomId'],
    registers: [this.registry],
  });

  // Счётчики по комнатам — свои (не читаем prom-client обратно): dec без add и
  // уборка stale-серий при нуле детерминированы.
  private readonly connectionCounts = new Map<string, number>();

  observePublishToDeliver(visibility: string, seconds: number): void {
    // recordedAt — часы БД, Date.now() — часы приложения: при skew возможен
    // отрицательный интервал, гистограмме он не нужен.
    this.publishToDeliver.observe({ visibility }, Math.max(0, seconds));
  }

  observeReplayDuration(level: string, seconds: number): void {
    this.replayDuration.observe({ level }, Math.max(0, seconds));
  }

  incCommitError(code: string): void {
    this.commitErrors.inc({ code });
  }

  connectionAdded(roomId: string): void {
    const next = (this.connectionCounts.get(roomId) ?? 0) + 1;
    this.connectionCounts.set(roomId, next);
    this.activeConnections.set({ roomId }, next);
  }

  connectionRemoved(roomId: string): void {
    const next = (this.connectionCounts.get(roomId) ?? 0) - 1;
    if (next <= 0) {
      // Не копим серии завершённых комнат со значением 0 (кардинальность = живым комнатам).
      this.connectionCounts.delete(roomId);
      this.activeConnections.remove(roomId);
      return;
    }
    this.connectionCounts.set(roomId, next);
    this.activeConnections.set({ roomId }, next);
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
```

- [ ] **Step 3: `metrics.module.ts` + barrel**

```ts
import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';

// Листовой модуль наблюдаемости (boundary observability-is-leaf, Task 6):
// доменные модули импортируют его, сам он доменных не знает.
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
```

`packages/core/src/index.ts` — добавить строки (рядом с прочими module-экспортами):

```ts
export * from './observability/metrics.module';
export * from './observability/metrics.service';
```

- [ ] **Step 4: Запустить — GREEN + гейты**

Run: `pnpm --filter @mymozhem/core test -- metrics.service.spec` → PASS.
Run: `pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core lint` → зелёные.

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/observability/ packages/core/src/index.ts
git commit -m "feat(core): observability MetricsModule — 4 метрики REQ-OPS-004 (prom-client)"
```

---

### Task 5: Инструментация realtime (gauge / счётчик фиксации / гистограммы)

**Закрывает:** REQ-OPS-004 (точки измерения). Дизайн §3; Review Focus 1, 3.

**Files:**
- Modify: `packages/core/src/realtime/subscription-registry.ts`
- Modify: `packages/core/src/realtime/subscription-registry.spec.ts`
- Modify: `packages/core/src/realtime/event-outbox.ts`
- Modify: `packages/core/src/realtime/event-outbox.int-spec.ts`
- Modify: `packages/core/src/realtime/realtime.gateway.ts`
- Modify: `packages/core/src/realtime/realtime.gateway.spec.ts`
- Modify: `packages/core/src/realtime/realtime.module.ts`

**Interfaces:**
- Consumes: `MetricsService`, `MetricsModule` (Task 4).
- Produces: `new SubscriptionRegistry(metrics: MetricsService)` (конструктор с параметром); `new EventOutbox(prisma, bus, metrics)`; `RealtimeGateway` — `metrics: MetricsService` **последним** параметром конструктора (после `config`); `RealtimeModule` импортирует `MetricsModule`.

- [ ] **Step 1: RED — registry gauge (unit)**

`subscription-registry.spec.ts`: конструирование перевести на `new SubscriptionRegistry(metrics)`, где в начале файла:

```ts
const makeMetrics = () => ({
  connectionAdded: jest.fn(),
  connectionRemoved: jest.fn(),
}) as unknown as MetricsService; // import type { MetricsService } from '../observability/metrics.service';
```

Добавить тест:

```ts
it('gauge: add инкрементирует, remove декрементирует, remove несуществующего — no-op (Review Focus 1)', () => {
  const metrics = makeMetrics();
  const registry = new SubscriptionRegistry(metrics);
  registry.add({ socketId: 's1', identityId: 'i1', roomId: 'r1', level: 'public' });
  expect(metrics.connectionAdded).toHaveBeenCalledWith('r1');
  registry.remove('s1');
  expect(metrics.connectionRemoved).toHaveBeenCalledWith('r1');
  registry.remove('s1'); // повтор — без декремента
  expect((metrics.connectionRemoved as jest.Mock).mock.calls).toHaveLength(1);
});
```

- [ ] **Step 2: GREEN — registry**

`subscription-registry.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { MetricsService } from '../observability/metrics.service';
import type { OutwardLevel } from './projection.service';

// ...интерфейс Subscription без изменений...

@Injectable()
export class SubscriptionRegistry {
  private readonly bySocket = new Map<string, Subscription>();
  private readonly socketsByMembership = new Map<string, Set<string>>();

  // REQ-OPS-004: gauge активных соединений живёт здесь, а не в gateway — все
  // пути очистки (disconnect, mid-subscribe cleanup, catch-пути, revoke) идут
  // через remove(), и парность инкремент/декремент гарантирована построением.
  constructor(private readonly metrics: MetricsService) {}

  // key(), get(), socketsOf() — без изменений.

  add(sub: Subscription): void {
    this.bySocket.set(sub.socketId, sub);
    const key = SubscriptionRegistry.key(sub.identityId, sub.roomId);
    const set = this.socketsByMembership.get(key) ?? new Set<string>();
    set.add(sub.socketId);
    this.socketsByMembership.set(key, set);
    this.metrics.connectionAdded(sub.roomId);
  }

  remove(socketId: string): void {
    const sub = this.bySocket.get(socketId);
    if (sub === undefined) return;
    this.bySocket.delete(socketId);
    const key = SubscriptionRegistry.key(sub.identityId, sub.roomId);
    const set = this.socketsByMembership.get(key);
    set?.delete(socketId);
    if (set?.size === 0) this.socketsByMembership.delete(key);
    this.metrics.connectionRemoved(sub.roomId);
  }
}
```

- [ ] **Step 3: RED — счётчик ошибок фиксации (int)**

`event-outbox.int-spec.ts`: конструирование outbox — добавить третий аргумент `new MetricsService()` (импорт из `../observability/metrics.service`; в этом файле сервисы собираются вручную — поправить точку `new EventOutbox(prisma, bus)`); завести переменную `metrics: MetricsService`. Добавить describe/тесты:

```ts
it('откат tx по нетипизированному сбою инкрементирует mymozhem_event_commit_errors_total (REQ-OPS-004)', async () => {
  await expect(outbox.run(() => Promise.reject(new Error('db gone')))).rejects.toThrow('db gone');
  expect(await metrics.render()).toContain('mymozhem_event_commit_errors_total{code="UNKNOWN"} 1');
});

it('типизированный отказ (ContractError) — штатный отказ гейтов, счётчик не трогаем', async () => {
  await expect(
    outbox.run(() => Promise.reject(new ContractError('PRIZE_FUND_EXHAUSTED', 'x'))),
  ).rejects.toMatchObject({ code: 'PRIZE_FUND_EXHAUSTED' });
  expect(await metrics.render()).not.toContain('mymozhem_event_commit_errors_total');
});
```

- [ ] **Step 4: GREEN — outbox**

`event-outbox.ts`: импорты `import { ContractError } from '@mymozhem/sdk';`, `import { RealtimeError } from './realtime.errors';`, `import type { MetricsService } from '../observability/metrics.service';` (`Prisma` уже импортирован). Конструктор — третий параметр `private readonly metrics: MetricsService`. Метод `run`:

```ts
  async run<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (this.als.getStore() !== undefined) {
      throw new EventOutboxNestedRunError();
    }
    const store = { events: [] as LogEvent[] };
    let result: T;
    try {
      result = await this.prisma.$transaction((tx) => this.als.run(store, () => fn(tx)));
    } catch (err) {
      // REQ-OPS-004: откат tx по СБОЮ фиксации (БД, баг) — считаем. Типизированные
      // отказы домена (ContractError/RealtimeError) — штатные отказы гейтов, их
      // rollback — не сбой: не считаем (дизайн ф.4 §3).
      if (!(err instanceof ContractError) && !(err instanceof RealtimeError)) {
        this.metrics.incCommitError(commitErrorLabel(err));
      }
      throw err;
    }
    // Flush строго после resolves $transaction (см. комментарий ниже в исходнике).
    this.bus.publish(store.events);
    return result;
  }
```

И module-local хелпер рядом с классами ошибок:

```ts
// Label счётчика ошибок фиксации: P-код Prisma (ограниченное множество) либо UNKNOWN.
function commitErrorLabel(err: unknown): string {
  return err instanceof Prisma.PrismaClientKnownRequestError ? err.code : 'UNKNOWN';
}
```

- [ ] **Step 5: RED — гистограммы gateway (unit)**

`realtime.gateway.spec.ts`:
- В `makeGateway` добавить `fakeMetrics` и пробросить последним аргументом `new RealtimeGateway(...)`:

```ts
const fakeMetrics = {
  observePublishToDeliver: jest.fn(),
  observeReplayDuration: jest.fn(),
  connectionAdded: jest.fn(),
  connectionRemoved: jest.fn(),
  incCommitError: jest.fn(),
};
// ...в конструктор после config: `, fakeMetrics as never`
// (SubscriptionRegistry по умолчанию — new SubscriptionRegistry(fakeMetrics as never))
```

- Добавить тесты:

```ts
it('subscribe замеряет длительность replay (REQ-OPS-004)', async () => {
  const { gateway, metrics } = makeGateway({});
  const socket = fakeSocket();
  // через публичный handleSubscribe (паттерн существующих subscribe-тестов файла):
  await gateway.handleSubscribe(socket as never, { roomId: ROOM }, jest.fn() as never);
  expect(metrics.observeReplayDuration).toHaveBeenCalledWith('public', expect.any(Number));
});

it('fan-out замеряет publish→deliver по recordedAt события (REQ-OPS-004)', async () => {
  const { gateway, bus, metrics, server } = makeGateway({});
  gateway.afterInit(server as never);
  const listener = (bus.subscribe as jest.Mock).mock.calls[0][0] as (e: readonly unknown[]) => void;
  listener([
    {
      roomId: ROOM,
      seq: 1,
      type: 'quiz.question.opened',
      payload: {},
      actorId: null,
      visibility: 'PUBLIC',
      schemaVersion: 1,
      recordedAt: new Date(Date.now() - 120),
    },
  ]);
  expect(metrics.observePublishToDeliver).toHaveBeenCalledWith('public', expect.any(Number));
  expect((metrics.observePublishToDeliver as jest.Mock).mock.calls[0][1]).toBeGreaterThanOrEqual(0.1);
});
```

(`makeGateway` дополнить возвратом `metrics`, `bus`, `server`-фейком — по фактической структуре файла; server-фейк: `{ use: jest.fn(), on: jest.fn(), to: jest.fn().mockReturnValue({ emit: jest.fn() }), sockets: { sockets: new Map() } }`.)

- [ ] **Step 6: GREEN — gateway**

`realtime.gateway.ts`:
- Импорт `import { MetricsService } from '../observability/metrics.service';`
- Конструктор — последний параметр `private readonly metrics: MetricsService`.
- В `handleSubscribe` — обернуть чтение лога и сборку snapshot:

```ts
      const replayStart = performance.now();
      const events = await this.prisma.logEvent.findMany({
        where: { roomId },
        orderBy: { seq: 'asc' },
      });
      // ...manifest/snapshot как было...
      // REQ-OPS-004: длительность replay = чтение лога + построение snapshot.
      this.metrics.observeReplayDuration(level, (performance.now() - replayStart) / 1000);
```

- В `fanOut` после успешного `emit` каждого события:

```ts
        // REQ-OPS-004: латентность publish→deliver от коммита (recordedAt — DB now()).
        this.metrics.observePublishToDeliver(
          event.visibility.toLowerCase(),
          (Date.now() - event.recordedAt.getTime()) / 1000,
        );
```

(внутри `try` после веток `if/else if` с emit; для MODULE_PRIVATE ветки emit нет — замер не делаем, доставки нет.)

- [ ] **Step 7: RealtimeModule**

`realtime.module.ts`: импорт `import { MetricsModule } from '../observability/metrics.module';` и `MetricsModule` первым в `imports`.

- [ ] **Step 8: Прогоны — GREEN и регрессия**

Run: `pnpm --filter @mymozhem/core test -- realtime` → PASS (registry/gateway/projection/bus спеки).
Run: `pnpm --filter @mymozhem/core test:int -- event-outbox.int-spec` → PASS.
Run: `pnpm --filter @mymozhem/core test:int` → PASS (все int-ланы: деревья с RealtimeModule получают MetricsModule транзитивно).
Run: `pnpm build && pnpm run boundary-check` → зелёные.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/realtime/ packages/core/src/index.ts
git commit -m "feat(realtime): instrument REQ-OPS-004 metrics — connections gauge, commit errors, publish→deliver, replay"
```

---

### Task 6: `GET /metrics` + boundary-правила observability

**Закрывает:** REQ-OPS-004 (экспозиция), REQ-DEV-001 (boundary новых правил). Дизайн §3, §6.

**Files:**
- Create: `packages/core/src/observability/metrics.controller.ts`
- Create: `packages/core/src/observability/observability.module.ts`
- Create: `packages/core/src/observability/observability.int-spec.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `.dependency-cruiser.cjs`
- Modify: `scripts/verify-guardrails.mjs`

**Interfaces:**
- Consumes: `MetricsService`, `MetricsModule` (Task 4).
- Produces: `ObservabilityModule` (imports `MetricsModule`, controllers `[MetricsController]`) — экспортирован из barrel core; `GET /metrics` → 200, body Prometheus text format, Content-Type из registry. Правила depcruise `observability-is-leaf` и `observability-libs-contained` (+2 probe в guardrails).

- [ ] **Step 1: RED — int-спека `observability.int-spec.ts`**

Бутстрап — по образцу `rewards.controller.int-spec.ts` (fastify-адаптер, `Test.createTestingModule`, override APP_CONFIG на TEST_CONFIG; БД не нужна — контроллер читает только registry). Дерево: `ConfigModule, ObservabilityModule`. Тесты:

```ts
it('GET /metrics — 200, text format, 4 метрики REQ-OPS-004', async () => {
  const metrics = moduleRef.get(MetricsService);
  metrics.connectionAdded('11111111-1111-4111-8111-111111111111');
  const res = await app.inject({ method: 'GET', url: '/metrics' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain('text/plain');
  expect(res.body).toContain('mymozhem_active_connections{roomId="11111111-1111-4111-8111-111111111111"} 1');
  expect(res.body).toContain('mymozhem_publish_to_deliver_seconds');
  expect(res.body).toContain('mymozhem_replay_duration_seconds');
  expect(res.body).toContain('mymozhem_event_commit_errors_total');
});

it('GET /metrics не требует авторизации (открытый — решение владельца, дизайн §0.3)', async () => {
  const res = await app.inject({ method: 'GET', url: '/metrics' }); // без заголовков
  expect(res.statusCode).toBe(200);
});
```

- [ ] **Step 2: Запустить — RED**

Run: `pnpm --filter @mymozhem/core test:int -- observability.int-spec`
Expected: FAIL (модулей нет).

- [ ] **Step 3: GREEN — контроллер и модуль**

`metrics.controller.ts`:

```ts
import { Controller, Get, Res } from '@nestjs/common';
import { MetricsService } from './metrics.service';

// Core не знает fastify (ReplyLike-прецедент http-exception.filter): структурный
// минимум ответа; FastifyReply совместим по форме.
interface MetricsReply {
  header(name: string, value: string): unknown;
  send(body: string): unknown;
}

// REQ-OPS-004: экспозиция Prometheus text format. Открытый (решение владельца,
// дизайн ф.4 §0.3) — как /health; авторизация и CORS-гейты не применяются.
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  async getMetrics(@Res() reply: MetricsReply): Promise<void> {
    reply.header('Content-Type', this.metrics.contentType);
    reply.send(await this.metrics.render());
  }
}
```

`observability.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsModule } from './metrics.module';

// Фасад наблюдаемости (ф.4): /metrics + (батч C) pino-конфигурация. Листовой —
// доменные модули импортируют его, не наоборот (observability-is-leaf).
@Module({
  imports: [MetricsModule],
  controllers: [MetricsController],
  exports: [MetricsModule],
})
export class ObservabilityModule {}
```

`packages/core/src/index.ts` — добавить:

```ts
export * from './observability/observability.module';
```

- [ ] **Step 4: Запустить — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- observability.int-spec` → PASS.

- [ ] **Step 5: Boundary-правила `.dependency-cruiser.cjs`**

В `forbidden` добавить два правила:

```js
    {
      name: 'observability-is-leaf',
      comment:
        'core/observability — лист: не импортирует доменные модули ядра ' +
        '(REQ-OPS-004, дизайн ф.4 §6; доменные импортируют его, не наоборот). ' +
        'config — инфраструктурное исключение (APP_CONFIG для pino-фабрики).',
      severity: 'error',
      from: { path: '^packages/core/src/observability', pathNot: '[.]spec[.]ts$' },
      to: {
        path: '^packages/core/src',
        pathNot: ['^packages/core/src/observability', '^packages/core/src/config'],
      },
    },
    {
      name: 'observability-libs-contained',
      comment:
        'Библиотеки наблюдаемости (nestjs-pino/pino/pino-http/prom-client) импортируются ' +
        'только в core/observability, barrel core и bootstrap apps/server (дизайн ф.4 §6).',
      severity: 'error',
      from: {
        pathNot: [
          '^packages/core/src/observability',
          '^packages/core/src/index[.]ts$',
          '^apps/server/src/main[.]ts$',
          '[/\\\\]dist[/\\\\]',
        ],
      },
      to: { path: 'node_modules/(nestjs-pino|pino-http|prom-client|pino)[/\\\\]' },
    },
```

- [ ] **Step 6: Probes в `scripts/verify-guardrails.mjs`**

Два новых probe-файла (запись рядом с существующими, удаление в `finally`):

```js
// 9) Observability-leaf probe: observability импортирует доменный модуль
// (forbidden: observability-is-leaf). Относительный импорт (прецедент probe 4).
const obsLeafProbe = 'packages/core/src/observability/__probe-leaf.ts';
writeFileSync(
  obsLeafProbe,
  "import '../room/room.module';\nexport const probe = 1;\n",
);

// 10) Observability-libs probe: prom-client вне observability
// (forbidden: observability-libs-contained). Пакетный spec — правило матчится
// по node_modules-пути резолва (прецедент probe 7).
const obsLibsProbe = 'packages/core/src/room/__probe-obs-libs.ts';
writeFileSync(
  obsLibsProbe,
  "import 'prom-client';\nexport const probe = 1;\n",
);
```

И два `expectFailure` в try-блок:

```js
  expectFailure(
    'observability → core domain import (dependency-cruiser)',
    `pnpm exec depcruise ${obsLeafProbe} --config .dependency-cruiser.cjs`,
    'observability-is-leaf',
  );
  expectFailure(
    'prom-client outside observability (dependency-cruiser)',
    `pnpm exec depcruise ${obsLibsProbe} --config .dependency-cruiser.cjs`,
    'observability-libs-contained',
  );
```

- [ ] **Step 7: Гейты**

Run: `pnpm run guardrails` → все 10 probes OK.
Run: `pnpm build && pnpm run boundary-check` → зелёные.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/observability/ packages/core/src/index.ts .dependency-cruiser.cjs scripts/verify-guardrails.mjs
git commit -m "feat(core): GET /metrics (open, REQ-OPS-004) + observability boundary rules and probes"
```

---

### Task 7: LOG_LEVEL + pino-конфигурация (PinoLoggerModule)

**Закрывает:** REQ-OPS-004 (логи — инфраструктура), REQ-OPS-003 (LOG_LEVEL в единой схеме). Дизайн §2.

**Files:**
- Modify: `packages/core/package.json` (deps `nestjs-pino`, `pino`, `pino-http`)
- Modify: `packages/core/src/config/config.schema.ts`
- Modify: `packages/core/src/testing/test-config.ts`
- Create: `packages/core/src/observability/pino-logger.module.ts`
- Create: `packages/core/src/observability/pino-options.spec.ts`

**Interfaces:**
- Consumes: `ObservabilityModule`-каталог (Task 6), `APP_CONFIG`.
- Produces: `LOG_LEVEL` в `AppConfig` (pino-уровни, дефолт `'info'`); `buildPinoHttpOptions(config: AppConfig)` (чистая фабрика: level, genReqId с `x-request-id`, redact authorization/cookie); `PINO_STREAM` (Symbol, опциональное назначение логов для тестов); `PinoLoggerModule` (dynamic module const — импорт только по ссылке). Потребители — Tasks 8/9.

- [ ] **Step 0: Зависимости**

Run: `pnpm --filter @mymozhem/core add nestjs-pino@^4.4.0 pino@^9.6.0 pino-http@^10.4.0`

- [ ] **Step 1: RED — конфиг**

`config.schema.ts` — в объект схемы (после `OAUTH_RATE_LIMIT`):

```ts
  // REQ-OPS-004 (ф.4): уровень структурных логов (pino levels).
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
```

`test-config.ts` — добавить поле (иначе typecheck TEST_CONFIG упадёт — это и есть RED формы конфига):

```ts
  LOG_LEVEL: 'warn', // меньше шума в лане; спеки на уровень конструируют конфиг сами
```

Run: `pnpm --filter @mymozhem/core test -- config.schema.spec` → прогон существующей спеки (зелёный — поле с дефолтом обратно-совместимо); RED несёт спека шага 2.

- [ ] **Step 2: RED — `pino-options.spec.ts`**

```ts
import { TEST_CONFIG } from '../testing/test-config';
import { buildPinoHttpOptions } from './pino-logger.module';

// REQ-OPS-004 (ф.4, дизайн §2): опции pino-http — чистая фабрика, юнит-гейты.
describe('buildPinoHttpOptions (REQ-OPS-004)', () => {
  it('уровень — из конфига', () => {
    expect(buildPinoHttpOptions({ ...TEST_CONFIG, LOG_LEVEL: 'debug' }).level).toBe('debug');
  });

  it('redact маскирует authorization и cookie (Review Focus 5)', () => {
    const opts = buildPinoHttpOptions(TEST_CONFIG);
    expect(opts.redact.paths).toEqual(['req.headers.authorization', 'req.headers.cookie']);
  });

  it('genReqId генерирует uuid и отражает его в заголовок x-request-id', () => {
    const setHeader = jest.fn();
    const id = buildPinoHttpOptions(TEST_CONFIG).genReqId({ headers: {} }, { setHeader });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', id);
  });
});
```

Run: `pnpm --filter @mymozhem/core test -- pino-options.spec` → FAIL (модуля нет).

- [ ] **Step 3: GREEN — `pino-logger.module.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';

// REQ-OPS-004 (ф.4, дизайн §2): структурные JSON-логи поверх nestjs-pino.
// Корреляция requestId — из genReqId (pino-http кладёт его в req.id и в каждую
// строку лога запроса); roomId/actorId привязываются потребителями через
// logger.assign/поля в операционных точках (Task 8), не middleware-магией.

// Опциональное назначение логов: прод — stdout (pino default); тесты подставляют
// буферный Writable и читают фактические JSON-строки (observability.int-spec).
export const PINO_STREAM = Symbol('PINO_STREAM');

interface GenReqIdReq {
  headers: Record<string, unknown>;
}
interface GenReqIdRes {
  setHeader(name: string, value: string): void;
}

// Чистая фабрика опций pino-http — юнит-тестируема без Nest (pino-options.spec).
export function buildPinoHttpOptions(config: AppConfig): {
  level: string;
  genReqId: (req: GenReqIdReq, res: GenReqIdRes) => string;
  redact: { paths: string[]; censor: string };
} {
  return {
    level: config.LOG_LEVEL,
    // requestId — uuid; отражаем в ответ для разбора инцидентов с игроками.
    genReqId: (_req: GenReqIdReq, res: GenReqIdRes): string => {
      const id = randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // Тела и payload'ы не логируются нормой дизайна; секретные заголовки маскируем.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      censor: '[redacted]',
    },
  };
}

// Dynamic module определён ОДИН раз и импортируется только по ссылке — Nest
// дедуплицирует его по метаданным, повторный импорт в дереве не порождает
// дубль-регистрацию провайдеров. LoggerModule nestjs-pino — @Global: после
// включения в дерево PinoLogger резолвится в любом модуле этого дерева.
export const PinoLoggerModule = LoggerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [APP_CONFIG, { token: PINO_STREAM, optional: true }],
  useFactory: (config: AppConfig, stream?: unknown) => ({
    pinoHttp: stream === undefined ? buildPinoHttpOptions(config) : { ...buildPinoHttpOptions(config), stream },
  }),
});
```

- [ ] **Step 4: Запустить — GREEN + typecheck/lint**

Run: `pnpm --filter @mymozhem/core test -- pino-options.spec` → PASS.
Run: `pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core lint` → зелёные.

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/config/config.schema.ts packages/core/src/testing/test-config.ts packages/core/src/observability/pino-logger.module.ts packages/core/src/observability/pino-options.spec.ts
git commit -m "feat(core): LOG_LEVEL config + PinoLoggerModule (nestjs-pino, requestId, redact) — REQ-OPS-004"
```

---

### Task 8: Миграция логирования на pino + корреляция roomId/actorId

**Закрывает:** REQ-OPS-004 (логи — потребители и корреляция). Дизайн §2 («не две стеки»). 

**Files:**
- Modify: `packages/core/src/identity/guest-sweep.service.ts`
- Modify: `packages/core/src/identity/identity-sweep.module.ts`
- Modify: `packages/core/src/identity/identity.module.ts`
- Modify: `packages/core/src/membership/membership.service.ts`
- Modify: `packages/core/src/membership/membership.module.ts`
- Modify: `packages/core/src/realtime/realtime.gateway.ts`
- Modify: `packages/core/src/realtime/realtime.gateway.spec.ts`
- Modify: `packages/core/src/realtime/realtime.module.ts`
- Modify: `packages/core/src/transport/http-exception.filter.ts`
- Modify: `packages/core/src/transport/http-exception.filter.spec.ts`
- Modify: `packages/core/src/transport/transport.module.ts`

**Interfaces:**
- Consumes: `PinoLoggerModule`, `PINO_STREAM` (Task 7); `MetricsService` в gateway (Task 5).
- Produces: все 5 прежних точек `new Logger(...)` — на инжектированном `PinoLogger` (setContext в конструкторе); модули Identity/Membership/Realtime/Transport/IdentitySweep импортируют `PinoLoggerModule` (по ссылке). Логи операционных точек несут поля `{ roomId, actorId }`/`{ socketId }` там, где значения уже есть в скоупе.

- [ ] **Step 1: RED — спеки на новые конструкторы и поля**

`realtime.gateway.spec.ts` (`makeGateway`): добавить `fakeLogger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }` и пробросить **последним** аргументом конструктора (после metrics). Новый тест:

```ts
it('subscribe-лог несёт корреляцию socketId/actorId/roomId, payload не логируется (REQ-OPS-004, REQ-SEC-009)', async () => {
  const { gateway, logger } = makeGateway({});
  const socket = fakeSocket();
  await gateway.handleSubscribe(socket as never, { roomId: ROOM }, jest.fn() as never);
  expect(logger.info).toHaveBeenCalledWith(
    expect.objectContaining({ socketId: 'socket-1', actorId: GUEST_CLAIMS.sub, roomId: ROOM }),
    expect.any(String),
  );
  const logged = JSON.stringify((logger.info as jest.Mock).mock.calls);
  expect(logged).not.toContain('payload');
});
```

`http-exception.filter.spec.ts`: `makeFilter` → `new HttpExceptionFilter(fakeLogger)` с `fakeLogger = { setContext: jest.fn(), error: jest.fn(), warn: jest.fn() }`; `makeHost` дополнить `getRequest: () => ({ id: 'req-1' })`; шпионы `Logger.prototype` (Nest) удалить — вместо них ассерты на `fakeLogger`. Добавить кейс:

```ts
it('5xx-лог несёт requestId из запроса (REQ-OPS-004)', () => {
  const { filter, reply, logger } = makeFilter();
  filter.catch(new Error('boom'), makeHost(reply) as never);
  expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-1' }), expect.any(String));
});
```

Run обе спеки → FAIL (конструкторы/поля не совпадают).

- [ ] **Step 2: GREEN — фильтр**

`http-exception.filter.ts`:
- Импорты: убрать `Logger` из `@nestjs/common`; `import { PinoLogger } from 'nestjs-pino';`
- Заменить поле на конструктор:

```ts
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(HttpExceptionFilter.name);
  }
```

- В `catch`: читать запрос и логировать с requestId:

```ts
    const req = host.switchToHttp().getRequest<{ id?: string }>();
    const requestId = req.id;
    // ...
    if (status >= 500) {
      this.logger.error({ requestId, err: exception }, 'request failed');
    } else if (exception instanceof AuthError || exception instanceof OAuthError) {
      this.logger.warn({ requestId }, exception.message);
    }
```

(Комментарий про «различие reuse/expired обязан нести серверный лог» — сохранить.)

- [ ] **Step 3: GREEN — gateway**

`realtime.gateway.ts`:
- Убрать `Logger` из импортов `@nestjs/common`, `import { PinoLogger } from 'nestjs-pino';`
- Конструктор — последний параметр `private readonly logger: PinoLogger` (после `metrics`); тело конструктора: `this.logger.setContext(RealtimeGateway.name);` (удалить поле `private readonly logger = new Logger(...)`).
- `authenticate`: warn → `this.logger.warn({ socketId: socket.id }, \`socket auth failed: ${(err as Error).message}\`);`
- В `server.on('connection', …)` — операционные логи:

```ts
    server.on('connection', (socket) => {
      this.logger.info({ socketId: socket.id, actorId: claimsOf(socket).sub }, 'socket connected');
      socket.on(REALTIME_MESSAGES.SUBSCRIBE, ...); // как было
      socket.on(REALTIME_MESSAGES.PUBLISH, ...);    // как было
      socket.on('disconnect', () => {
        this.logger.info({ socketId: socket.id }, 'socket disconnected');
        this.registry.remove(socket.id);
      });
    });
```

- В `handleSubscribe` после `ack({ ok: true, snapshot })`:

```ts
      this.logger.info(
        { socketId: socket.id, actorId: claims.sub, roomId, level },
        'subscribed',
      );
```

(перед ним сам `ack` — порядок: лог после ack, чтобы ack не задерживать).
- `fanOut` catch: `this.logger.error({ roomId: event.roomId, seq: event.seq, type: event.type, err }, 'fan-out failed');` (payload НЕ логируется — REQ-SEC-009).
- `wireCodeOf`: `this.logger.error({ err }, 'unmapped realtime error');`

- [ ] **Step 4: GREEN — sweep / scheduler / membership**

`guest-sweep.service.ts`: PinoLogger (setContext), логи:
- успех: `this.logger.info({ anonymized: anonymized.count, suspended: suspended.size }, 'guest sweep');`
- откат C-8.1: `this.logger.warn({ raced: err.racedCount }, 'guest sweep rolled back: concurrent award (C-8.1)');`

`identity-sweep.module.ts` (GuestSweepScheduler): PinoLogger; catch: `this.logger.error({ err }, 'guest sweep failed');`

`membership.service.ts`: PinoLogger (setContext) вместо `new Logger`; существующее сообщение (строка ~163, error-лог слушателя `onAccessRevoked`) — сохранить текст, добавить поля из скоупа (`identityId`, `roomId` — что есть в точке вызова). Новых логов не добавлять.

- [ ] **Step 5: Импорты модулей**

В `imports` добавить `PinoLoggerModule` (импорт из `../observability/pino-logger.module`):
- `identity.module.ts`
- `identity-sweep.module.ts`
- `membership.module.ts`
- `realtime.module.ts`
- `transport.module.ts`

- [ ] **Step 6: Прогоны — GREEN и регрессия всех затронутых лан**

Run: `pnpm --filter @mymozhem/core test` → PASS (gateway/filter/registry спеки).
Run: `pnpm --filter @mymozhem/core test:int` → PASS (guest-sweep, membership, realtime, rewards, observability — DI-деревья получают PinoLogger транзитивно).
Run: `pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core lint` → зелёные.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/identity/ packages/core/src/membership/ packages/core/src/realtime/ packages/core/src/transport/
git commit -m "refactor(core): migrate logging to pino with requestId/roomId/actorId correlation (REQ-OPS-004)"
```

---

### Task 9: Composition root + e2e-приёмка наблюдаемости

**Закрывает:** REQ-OPS-004 (e2e-приёмка), REQ-OPS-003 (boot). Дизайн §5; Review Focus 5.

**Files:**
- Modify: `packages/core/src/observability/observability.module.ts` (+PinoLoggerModule)
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/package.json` (dep `nestjs-pino`)
- Modify: `packages/core/src/observability/observability.int-spec.ts` (pino-stream сценарий)
- Modify: `apps/server/test/transport.e2e-spec.ts` (x-request-id)
- Modify: `apps/server/test/realtime.e2e-spec.ts` (метрики на проводе)

**Interfaces:**
- Consumes: всё из Tasks 4–8.
- Produces: `AppModule` включает `ObservabilityModule`; `main.ts` — `app.useLogger(app.get(Logger))`; e2e-ассерты приёмки.

- [ ] **Step 0: Зависимость apps/server**

Run: `pnpm --filter @mymozhem/server add nestjs-pino@^4.4.0`

- [ ] **Step 1: RED — pino-stream сценарий в `observability.int-spec.ts`**

Дополнить существующий файл: в дерево тестового модуля провайдер `{ provide: PINO_STREAM, useValue: logBuffer }`, где

```ts
import { Writable } from 'node:stream';

const logLines: string[] = [];
const logBuffer = new Writable({
  write(chunk, _enc, cb) {
    logLines.push(chunk.toString());
    cb();
  },
});
```

Тест:

```ts
it('строка лога запроса — JSON с requestId; authorization/cookie замаскированы (Review Focus 5)', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/metrics',
    headers: { authorization: 'Bearer SECRET-TOKEN', cookie: 'mm_refresh=SECRET-COOKIE' },
  });
  expect(res.statusCode).toBe(200);
  const requestId = res.headers['x-request-id'];
  const line = logLines.map((l) => l.trim()).filter((l) => l.includes('"req"')).pop();
  expect(line).toBeDefined();
  const parsed = JSON.parse(line!);
  expect(parsed.req.id).toBe(requestId);
  expect(line).not.toContain('SECRET-TOKEN');
  expect(line).not.toContain('SECRET-COOKIE');
});
```

- [ ] **Step 2: GREEN — wiring**

`observability.module.ts`: в `imports` добавить `PinoLoggerModule` (первым, из `./pino-logger.module`).

`apps/server/src/app.module.ts`: импорт `ObservabilityModule` из `@mymozhem/core`; в `imports` — сразу после `HealthModule`.

`apps/server/src/main.ts`:
- Импорт `import { Logger } from 'nestjs-pino';`
- Сразу после `NestFactory.create(...)`:

```ts
  // REQ-OPS-004: системные логи Nest — тоже через pino (единая стека).
  app.useLogger(app.get(Logger));
```

- [ ] **Step 3: Прогон int — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- observability.int-spec` → PASS.

- [ ] **Step 4: RED/GREEN — e2e `transport.e2e-spec.ts`**

Добавить в существующий describe (бут изменить не нужно — e2e зеркалит main.ts и собирает AppModule; `useLogger` там не вызывается, но LoggerModule в дереве есть через AppModule):

```ts
it('ответ несёт x-request-id (REQ-OPS-004)', async () => {
  const res = await app.inject({ method: 'GET', url: '/health/live' });
  expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
```

Run: `pnpm build && pnpm --filter @mymozhem/server test -- transport.e2e` → PASS.

- [ ] **Step 5: RED/GREEN — e2e `realtime.e2e-spec.ts`: метрики на проводе**

Новый сценарий (стиль файла: сокеты через реальный listen, HTTP — `app.inject`):

```ts
it('/metrics отражает realtime-жизнь комнаты: gauge, replay, publish→deliver (REQ-OPS-004)', async () => {
  // комната+гость+сокет — существующими хелперами файла (join → access token → io())
  // ...подключить сокет, дождаться subscribe-ack...
  const duringRes = await app.inject({ method: 'GET', url: '/metrics' });
  expect(duringRes.statusCode).toBe(200);
  expect(duringRes.body).toContain(`mymozhem_active_connections{roomId="${roomId}"} 1`);
  expect(duringRes.body).toContain('mymozhem_replay_duration_seconds_count{level="public"} 1');

  // publish app-события (существующий сценарий файла — quiz.question.opened организатором
  // либо доступный клиентский тип) → ack ok → fan-out
  // ...
  const afterPublish = await app.inject({ method: 'GET', url: '/metrics' });
  expect(afterPublish.body).toContain('mymozhem_publish_to_deliver_seconds_count{visibility="public"} 1');

  socket.close();
  // дождаться обработки disconnect (poll /metrics до исчезновения серии, ≤ 2 с):
  await expect
    .poll(async () => (await app.inject({ method: 'GET', url: '/metrics' })).body, { timeout: 2000 })
    .not.toContain(`mymozhem_active_connections{roomId="${roomId}"}`);
});
```

(`expect.poll` — vitest-форма, в jest использовать ручной цикл ожидания с таймаутом по прецеденту waitEventWhere файла; суть ассерта — серия комнаты исчезает после disconnect.)

Run: `pnpm build && pnpm --filter @mymozhem/server test -- realtime.e2e` → PASS.

- [ ] **Step 6: Полные гейты конвейера**

Run: `pnpm build && pnpm run boundary-check && pnpm run guardrails && pnpm run lint && pnpm run typecheck && pnpm run test && pnpm --filter @mymozhem/core test:int && pnpm --filter @mymozhem/server test`
Expected: всё зелёное.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/observability/ apps/server/ pnpm-lock.yaml
git commit -m "feat(server): wire observability — /metrics, pino system logger, e2e acceptance (REQ-OPS-004)"
```

---

### Task 10: Exit-аудит среза (батч D, с финревью батча C)

**Закрывает:** §7 дизайна (критерии выхода), фиксация REQ-SEC-008, REQ-DEV-003 (артефакт в docs/sessions).

**Files:**
- Create: `docs/sessions/2026-09-2X-phase-4-hardening-exit-audit.md` (X — фактическая дата финальной сессии)
- Modify: `HANDOFF.md`

**Interfaces:**
- Consumes: весь срез (Tasks 1–9).
- Produces: сверка критериев с артефактами файл:строка; обновлённый HANDOFF.

- [ ] **Step 1: Сверка 5 критериев §7 дизайна**

Для каждого критерия — артефакт:
1. `/metrics` отдаёт 4 метрики, gauge сходится с реальностью — `observability.int-spec.ts`, сценарий в `realtime.e2e-spec.ts` (Task 9).
2. Гонка свипа воспроизводится и закрыта rollback'ом; award swept-identity → `IDENTITY_ANONYMIZED`, фонд цел — `guest-sweep.int-spec.ts` (describe C-8.1), `rewards.int-spec.ts` (Task 3).
3. Логи JSON с requestId/roomId/actorId; redact — `pino-options.spec.ts`, `observability.int-spec.ts` (pino-stream), `realtime.gateway.spec.ts` (корреляция).
4. **REQ-SEC-008 — подтверждён существующими артефактами без нового кода:** helmet/CORS wiring `apps/server/src/main.ts`, production-wildcard ban `packages/core/src/config/config.schema.ts` (superRefine), e2e-ассерт `apps/server/test/transport.e2e-spec.ts` («helmet: ответ join содержит security-заголовки (REQ-SEC-008)»), коммит `55afe8f`. Срез кодом SEC-008 не трогал.
5. Конвейер зелёный — вывод гейтов Task 9, шаг 6.

- [ ] **Step 2: Зафиксировать отложенное**

В аудите явно: REQ-RT-008 отложен решением владельца (дизайн §0.1) в нагрузочную часть ф.4; остаток ф.4 (нагрузочный профиль, лимиты) — после первого живого события; OPS-006 — после юриста.

- [ ] **Step 3: HANDOFF**

Обновить по конвенции: срез исполнен, коммиты батчей, новые швы для будущих планов:
- `MetricsService` конструируется вручную в спеках (беззависимостный); gauge живёт в SubscriptionRegistry (парность add/remove).
- `AnonymizationGuard.hasOpenAwards(tx, ids)` — tx-первый параметр; PrismaService из гардов убран.
- `PinoLoggerModule` — dynamic module const, импорт только по ссылке; `PINO_STREAM` — тестовое назначение логов.
- `IDENTITY_ANONYMIZED` (409) — SDK 1.8.0; award.points гардой не покрыт (осознанно).
- `observability-is-leaf` / `observability-libs-contained` — новые boundary-правила + probes.
- Deferred-кандидаты из финревью батчей A–D.

- [ ] **Step 4: Commit**

```bash
git add docs/sessions/ HANDOFF.md
git commit -m "docs(sessions): phase-4 hardening exit audit — критерии §7 сверены, SEC-008 зафиксирован"
```

---

## Self-review (проведён автором плана)

**Spec coverage:** §1 объём — OPS-004-логи (Tasks 7–9), OPS-004-метрики (Tasks 4–6, 9), C-8.1 (Tasks 1–3), SEC-008 фиксация (Task 10) — все покрыты. §2 логи: nestjs-pino/LoggerModule (T7), requestId+x-request-id (T7/T9), realtime-логи с socketId/actorId/roomId (T8), LOG_LEVEL в схеме (T7), миграция 5 точек (T8), redact (T7/T9), запрет payload/токенов (T8 ассерты). §3 метрики: 4 метрики/labels/buckets (T4), точки измерения (T5), открытый /metrics (T6), Content-Type (T6). §4 C-8.1: re-check+tx-aware гард (T2), award-гарда+код+409 (T1/T3), warn-лог отката (T2/T8), «без serializable» (не вводится). §5 тесты: гонка детерминированно стабом (T2), award-гарда int (T3), метрики unit+int+gauge-e2e (T4/T5/T9), pino-конфиг unit+x-request-id e2e+строка лога (T7/T9). §6 границы: observability-is-leaf + libs-contained + probes (T6), SDK минор (T1), LOG_LEVEL конфиг (T7), CI-гейты (T9). §8 вне объёма: не вводится.

**Placeholder scan:** код приведён для всех создаваемых файлов и нетривиальных правок; два места с осознанной привязкой «по фактической структуре файла» (gateway spec makeGateway, realtime.e2e хелперы) — там файл читается исполнителем, адаптация механическая, суть ассертов задана дословно.

**Type consistency:** `hasOpenAwards(tx, ids)` — одинакова в интерфейсе (T2), реализации (T2), стабе RacingGuard (T2) и вызовах (T2/T8). `MetricsService` методы — одинаковы в T4 (определение), T5 (потребители: `connectionAdded/Removed`, `incCommitError`, `observePublishToDeliver`, `observeReplayDuration`), T6/T9 (render/contentType). Порядок параметров конструкторов: EventOutbox `(prisma, bus, metrics)`; RealtimeGateway — `metrics`, затем `logger` последними (T5, T8 — последовательно); SubscriptionRegistry `(metrics)` (T5). `IDENTITY_ANONYMIZED` — одинаковое имя в T1/T3/T9.

**Review Focus:** 5 строк — все с пинами в задачах (T5, T4, T4, T3, T9).

**Риски исполнения, зафиксированные для исполнителя:**
- nestjs-pino ^4/pino-http ^10: если сигнатура `inject: [{ token, optional: true }]` или опция `stream` в pinoHttp отличается в установленной версии — поправить точку (фабрика/токен), не дизайн; отклонение зафиксировать в леджере батча.
- `Gauge.remove(roomId)` prom-client v15 удаляет серию — подтверждается тестом T4 шаг 1 (assert отсутствия серии), если API переименован — тест покажет RED на зелёном коде, чинить по доке v15.
