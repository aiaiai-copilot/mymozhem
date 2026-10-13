### Task 8: TTL-свип гостей + ANONYMIZATION_GUARDS + scheduler

**Files:**
- Create: `packages/core/src/identity/anonymization-guards.ts`
- Create: `packages/core/src/identity/guest-sweep.service.ts`
- Create: `packages/core/src/identity/identity-sweep.module.ts` (scheduler; только для composition root)
- Modify: `packages/core/src/identity/identity.module.ts` (GuestSweepService)
- Create: `packages/core/src/rewards/rewards-anonymization.guard.ts`
- Modify: `packages/core/src/rewards/rewards.module.ts` (guard provider + export)
- Modify: `packages/core/package.json` (dep `@nestjs/schedule`)
- Modify: `packages/core/src/index.ts` (barrel)
- Test: `packages/core/src/identity/guest-sweep.int-spec.ts`

**Interfaces:**
- Consumes: `CLEANUP_INTERVAL`/`GUEST_TTL` (Task 4/config), `RewardsService`-таблицы (Task 4), прецедент отзыва сессий (`membership.service.ts:118-123`), прецедент hook `onAccessRevoked` (membership).
- Produces:
  - `interface AnonymizationGuard { hasOpenAwards(identityIds: readonly string[]): Promise<Set<string>> }`, `ANONYMIZATION_GUARDS: symbol` (identity) — реализует `RewardsAnonymizationGuard`, связывает composition root (Task 11).
  - `GuestSweepService.sweepExpiredGuests(now?: Date): Promise<number>` — вызывается scheduler'ом и напрямую в тестах.
  - `IdentitySweepModule` (scheduler на SchedulerRegistry) — импортирует только composition root (Task 11).

**REQ:** REQ-ID-003/014 (догон свипа), REQ-RWD-013 (приостановка при открытой AWARDED), REQ-ID-010 (cleanup_interval), REQ-OPS-005 (одна реплика — дублей джобы нет), REQ-RWD-001 (identity не знает про rewards).

- [ ] **Step 1: Failing int-tests**

`packages/core/src/identity/guest-sweep.int-spec.ts`:

```typescript
// Бутстрап: ConfigModule + PrismaModule + IdentityModule + (RewardsModule для гарда)
// + AuthModule (issueGuestTokens создаёт Session-строки). TEST_CONFIG.GUEST_TTL = 86400.

describe('GuestSweepService (int, REQ-ID-003/014 + REQ-RWD-013)', () => {
  // Хелпер: expiredGuest() — seedIdentity(GUEST) + backdate:
  //   await db.prisma.$executeRaw`UPDATE identity."Identity" SET "createdAt" = now() - interval '25 hours' WHERE id = ${id}::uuid`;

  it('гость с истёкшим TTL анонимизируется: displayName/email → NULL, deletedAt выставлен, живые сессии отозваны', async () => {
    // expiredGuest + issueGuestTokens(guest.id, roomId) → sweepExpiredGuests()
    // identity: displayName null, deletedAt не null, id сохранён (анонимизация, не удаление)
    // session.revokedAt не null
  });

  it('гость с неистёкшим TTL и REGISTERED с истёкшим не тронуты', async () => {
    // fresh guest + backdated REGISTERED (email) → sweep → оба без deletedAt, email REGISTERED на месте
  });

  it('приостановка: гость с открытой AWARDED не анонимизируется; после fulfill — анонимизируется следующим проходом (REQ-RWD-013)', async () => {
    // expiredGuest + приз + award AWARDED на гостя (через RewardsService.executeEffects
    // в outbox.run) → sweep с guards=[RewardsAnonymizationGuard] → identity жива
    // (deletedAt null, displayName на месте); rewards.fulfill(...) → повторный sweep → анонимизирован.
    // То же через revoke.
  });

  it('без подключённых гардов приостановки нет (rewards не подключён — REQ-RWD-001)', async () => {
    // expiredGuest + открытая AWARDED (напрямую prisma.award.create) →
    // sweep с guards=[] → анонимизирован (приостанавливать некому).
  });
});
```

(Бутстрап модулей — по образцу rewards.int-spec.ts Task 5; сиды комнаты/приза — хелпером оттуда же, продублировать локально.)

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test:int -- guest-sweep`
Expected: FAIL (сервис не существует).

- [ ] **Step 3: Implement — токен и сервис свипа**

`packages/core/src/identity/anonymization-guards.ts`:

```typescript
// Приостановка TTL гостя через hook, не импортом (design 2026-09-10 §5,
// REQ-RWD-001/013): identity объявляет токен; rewards регистрирует guard в
// composition root. Паттерн — по прецеденту onAccessRevoked (membership).
export interface AnonymizationGuard {
  // Возвращает подмножество identityIds, у которых есть нерешённая награда
  // (AWARDED). identity про rewards не знает.
  hasOpenAwards(identityIds: readonly string[]): Promise<Set<string>>;
}

export const ANONYMIZATION_GUARDS = Symbol('ANONYMIZATION_GUARDS');
```

`packages/core/src/identity/guest-sweep.service.ts`:

```typescript
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { ANONYMIZATION_GUARDS, type AnonymizationGuard } from './anonymization-guards';

// Свип анонимизации гостей (REQ-ID-003/014, догон фазы 3): истечение guest_ttl
// реализуется анонимизацией строки (обнуление PII, сохранение id — внешние ключи
// и actorId в логе остаются валидными), не физическим удалением. База TTL —
// createdAt (решение владельца, design §0.8). Приостановка при открытой награде —
// через ANONYMIZATION_GUARDS (REQ-RWD-013); без подключённого rewards приостановки нет.
@Injectable()
export class GuestSweepService {
  private readonly logger = new Logger(GuestSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(ANONYMIZATION_GUARDS) private readonly guards: AnonymizationGuard[] = [],
  ) {}

  // Возвращает число анонимизированных identity. Вся выборка/гард/запись — одна
  // транзакция: гард-чек внутри неё закрывает окно гонки «награда создана между
  // чтением кандидатов и анонимизацией» (перечитывание deletedAt в updateMany —
  // вторая линия от гонки с ручным исключением).
  async sweepExpiredGuests(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.GUEST_TTL * 1000);
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.identity.findMany({
        where: { kind: 'GUEST', deletedAt: null, createdAt: { lt: cutoff } },
        select: { id: true },
      });
      if (candidates.length === 0) return 0;
      const ids = candidates.map((c) => c.id);
      const suspended = new Set<string>();
      for (const guard of this.guards) {
        for (const id of await guard.hasOpenAwards(ids)) suspended.add(id);
      }
      const sweepIds = ids.filter((id) => !suspended.has(id));
      if (sweepIds.length === 0) return 0;
      const anonymized = await tx.identity.updateMany({
        where: { id: { in: sweepIds }, deletedAt: null },
        data: { displayName: null, email: null, deletedAt: now },
      });
      // Отзыв живых сессий гостя — по прецеденту среза исключения
      // (membership.service.ts:118-123). Сессия гостя под приостановкой истекает
      // по своему капу как обычно (design §5) — здесь её нет.
      await tx.session.updateMany({
        where: { identityId: { in: sweepIds }, revokedAt: null },
        data: { revokedAt: now },
      });
      this.logger.log(`guest sweep: anonymized ${anonymized.count}, suspended ${suspended.size}`);
      return anonymized.count;
    });
  }
}
```

`identity.module.ts`: providers/exports += `GuestSweepService` (модуль и так импортирует PrismaModule; ConfigModule — добавить в imports, если APP_CONFIG не резолвится глобально — сверить с тем, как TokenService получает конфиг: AuthModule импортирует ConfigModule; здесь то же).

- [ ] **Step 4: Implement — guard rewards и scheduler**

`packages/core/src/rewards/rewards-anonymization.guard.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import type { AnonymizationGuard } from '../identity/anonymization-guards';
import { PrismaService } from '../prisma/prisma.service';

// REQ-RWD-013: гость с нерешённой наградой (AWARDED; FULFILLED/REVOKED — решённые)
// не анонимизируется до разрешения — иначе приз осиротеет из-за обнуления имени
// победителя до вручения.
@Injectable()
export class RewardsAnonymizationGuard implements AnonymizationGuard {
  constructor(private readonly prisma: PrismaService) {}

  async hasOpenAwards(identityIds: readonly string[]): Promise<Set<string>> {
    if (identityIds.length === 0) return new Set();
    const rows = await this.prisma.award.findMany({
      where: { winnerId: { in: [...identityIds] }, status: 'AWARDED' },
      select: { winnerId: true },
    });
    return new Set(rows.map((r) => r.winnerId));
  }
}
```

`rewards.module.ts`: providers/exports += `RewardsAnonymizationGuard`.

`packages/core/src/identity/identity-sweep.module.ts`:

```typescript
import { Inject, Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { ConfigModule } from '../config/config.module';
import { IdentityModule } from './identity.module';
import { GuestSweepService } from './guest-sweep.service';

// Регистрация интервала свипа — только в composition root (этот модуль не
// импортируется тестами: логика свипа покрыта прямым вызовом sweepExpiredGuests).
// SchedulerRegistry резолвится из ScheduleModule.forRoot() composition root'а
// (глобальный после forRoot). Одна реплика (REQ-OPS-005) — дублей джобы нет.
@Injectable()
class GuestSweepScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(GuestSweepScheduler.name);

  constructor(
    private readonly sweep: GuestSweepService,
    private readonly registry: SchedulerRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const interval = setInterval(() => {
      this.sweep.sweepExpiredGuests().catch((err) => {
        // Отказ прохода — error-лог, следующий проход повторит; джоба не роняет процесс.
        this.logger.error('guest sweep failed', err);
      });
    }, this.config.CLEANUP_INTERVAL * 1000);
    this.registry.addInterval('guest-sweep', interval);
  }

  onApplicationShutdown(): void {
    this.registry.deleteInterval('guest-sweep');
  }
}

@Module({
  imports: [ConfigModule, IdentityModule],
  providers: [GuestSweepScheduler],
})
export class IdentitySweepModule {}
```

`packages/core/package.json`: dependencies += `"@nestjs/schedule": "^6.0.0"` (совместимая с Nest 11 мажорная линейка — сверить с npm при установке; зафиксировать фактическую в леджере), затем `pnpm install`.

Barrel `index.ts` += `export * from './identity/anonymization-guards';`, `export * from './identity/guest-sweep.service';`, `export * from './identity/identity-sweep.module';`, `export * from './rewards/rewards-anonymization.guard';`.

- [ ] **Step 5: Run — GREEN**

Run: `pnpm build && pnpm --filter @mymozhem/core test:int -- guest-sweep`
Expected: PASS. Затем полная лана core (unit + int). Внимание: IdentitySweepModule НЕ импортируется тестовыми модулями — расписание в тестах не стартует.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/identity packages/core/src/rewards packages/core/package.json pnpm-lock.yaml packages/core/src/index.ts
git commit -m "feat(core): TTL-свип гостей с приостановкой при открытой награде — ANONYMIZATION_GUARDS, GuestSweepService, scheduler

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

