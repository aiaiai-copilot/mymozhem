### Task 5: RewardsService — эффекты и автомат награды + commitRewardsEvent

**Files:**
- Create: `packages/core/src/rewards/rewards.errors.ts`
- Create: `packages/core/src/rewards/rewards.service.ts`
- Create: `packages/core/src/rewards/rewards.module.ts` (пока без контроллера и handler-провайдера — Tasks 6/11)
- Modify: `packages/core/src/realtime/event-log.service.ts` (refactor к commitStaticEvent + `commitRewardsEvent`)
- Modify: `packages/core/src/index.ts` (barrel: RewardsModule, RewardsService, ошибки)
- Test: `packages/core/src/rewards/rewards.int-spec.ts` (транзакционные сценарии), `packages/core/src/realtime/event-log.int-spec.ts` (существующий — кейс commitRewardsEvent)

**Interfaces:**
- Consumes: Prisma-модели Task 4; `REWARDS_EVENTS`/`RewardsEventName`/`rewardsEventType` Task 3; `EventOutbox.run`/`EventLogService`/`appendLocked` (realtime); коды Task 2.
- Produces:
  - `RewardsService.executeEffects(tx, roomId, sourceAppId, effects: readonly AppEffect[]): Promise<void>` — вызывает диспетчер внутри своего `outbox.run` (Task 7); реализация интерфейса `AwardEffectHandler` (токен объявляется в Task 7, здесь сигнатура уже совместима). `sourceAppId` — appId пиннутого модуля, его передаёт диспетчер (`'lottery'`, `'quiz'`).
  - `RewardsService.createPrize(roomId, actorId, input: CreatePrizeRequest): Promise<Prize>`; `listAwards(roomId, actorId): Promise<Award[]>`; `fulfill(roomId, awardId, actorId): Promise<Award>`; `revoke(roomId, awardId, actorId): Promise<Award>` — REST-контур Task 6.
  - `EventLogService.commitRewardsEvent(tx, roomId, name: RewardsEventName, payload, actorId = null): Promise<LogEvent>`.
  - Ошибки: `PrizeUnknownError` (PRIZE_UNKNOWN), `PrizeFundExhaustedError` (PRIZE_FUND_EXHAUSTED), `AwardUnknownError` (AWARD_UNKNOWN), `RewardAlreadyResolvedError` (REWARD_ALREADY_RESOLVED) — все `extends ContractError`.

**REQ:** REQ-RWD-003 (атомарность, идемпотентный no-op по индексу), REQ-RWD-007 (автомат, идемпотентные переходы), REQ-RWD-010 (ограниченный декремент), REQ-RWD-002b (award.points без приза), REQ-SEC-009 (события — только id).

- [ ] **Step 1: Failing int-tests — транзакционные инварианты**

`packages/core/src/rewards/rewards.int-spec.ts`. Бутстрап — Nest testing module (DI-контейнер, прецедент T7-рулинга Quiz-среза: сервис через контейнер, не вручную):

```typescript
import { Test } from '@nestjs/testing';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '../config/config.module';
import { MembershipModule } from '../membership/membership.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { EventOutbox } from '../realtime/event-outbox';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { RewardsModule } from './rewards.module';
import { RewardsService } from './rewards.service';
import { PrizeFundExhaustedError } from './rewards.errors';
import type { AppEffect } from '@mymozhem/sdk';

describe('RewardsService (int)', () => {
  let db: TestDb;
  let rewards: RewardsService;
  let outbox: EventOutbox;

  beforeAll(async () => {
    db = await startTestDb();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule, PrismaModule, AppRegistryModule.register([]),
        MembershipModule, RealtimeModule, RewardsModule,
      ],
    }).compile();
    rewards = moduleRef.get(RewardsService);
    outbox = moduleRef.get(EventOutbox);
  }, 120_000);

  afterAll(async () => { await db.stop(); });
  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE rewards."PointsGrant", rewards."Award", rewards."Prize", identity."Session", membership."Membership", room."Room" CASCADE',
    );
  });

  // Хелпер: комната DRAFT с организатором + приз с фондом quantity.
  // Поля Room.create сверить с schema.prisma (code unique, organizerId FK).
  async function seedPrize(quantity: number) {
    const org = await seedIdentity(db.prisma, { email: `org-${crypto.randomUUID()}@example.test` });
    const room = await db.prisma.room.create({ data: { code: crypto.randomUUID().slice(0, 8).toUpperCase(), organizerId: org.id } });
    const prize = await db.prisma.prize.create({ data: { roomId: room.id, name: 'Приз', quantityTotal: quantity, quantity } });
    return { org, room, prize };
  }
  const guest = () => seedIdentity(db.prisma, { kind: 'GUEST', displayName: 'Гость' });
  const prizeEffect = (prizeId: string, winnerId: string): AppEffect => ({ kind: 'award.prize', prizeId, winnerId });
```

Тесты:

```typescript
  it('award.prize: декремент + insert + событие reward.awarded одной транзакцией', async () => {
    const { room, prize } = await seedPrize(2);
    const winner = await guest();
    await outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, winner.id)]));
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(1);
    const awards = await db.prisma.award.findMany({ where: { roomId: room.id } });
    expect(awards).toHaveLength(1);
    expect(awards[0].status).toBe('AWARDED');
    const log = await db.prisma.$queryRaw<{ type: string; visibility: string; payload: { winnerId: string } }[]>`
      SELECT type, "visibility"::text AS visibility, payload FROM realtime."LogEvent" WHERE "roomId" = ${room.id}::uuid ORDER BY seq`;
    expect(log).toHaveLength(1);
    expect(log[0].type).toBe('rewards.reward.awarded');
    expect(log[0].visibility).toBe('public'); // сырое DB-значение lowercase (HANDOFF)
    expect(log[0].payload.winnerId).toBe(winner.id);
    expect(log[0].payload).not.toHaveProperty('displayName'); // REQ-SEC-009
  });

  it('K > quantity конкурентных награждений разным identity → ровно quantity успехов, без минуса (REQ-RWD-010)', async () => {
    const { room, prize } = await seedPrize(2);
    const winners = await Promise.all(Array.from({ length: 5 }, () => guest()));
    const results = await Promise.allSettled(
      winners.map((w) => outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, w.id)]))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(PrizeFundExhaustedError);
    }
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(0);
    expect(await db.prisma.award.count({ where: { prizeId: prize.id } })).toBe(2);
  });

  it('конкурентный дубль одного награждения → один победитель, quantity −1 ровно раз (REQ-RWD-003)', async () => {
    const { room, prize } = await seedPrize(5);
    const winner = await guest();
    const results = await Promise.allSettled([
      outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, winner.id)])),
      outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, winner.id)])),
    ]);
    // Оба завершились успешно: повтор — типизированный no-op, не отказ.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await db.prisma.award.count({ where: { prizeId: prize.id } })).toBe(1);
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(4);
  });

  it('повторное вручение — типизированный no-op; cross-переход (revoke после fulfill) — REWARD_ALREADY_RESOLVED (REQ-RWD-007)', async () => {
    const { org, room, prize } = await seedPrize(1);
    const winner = await guest();
    await outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, winner.id)]));
    const award = (await db.prisma.award.findFirstOrThrow({ where: { roomId: room.id } }));
    const done1 = await rewards.fulfill(room.id, award.id, org.id);
    const done2 = await rewards.fulfill(room.id, award.id, org.id);
    expect(done2.status).toBe('FULFILLED');
    expect(done2.fulfilledAt).toEqual(done1.fulfilledAt);
    await expect(rewards.revoke(room.id, award.id, org.id)).rejects.toMatchObject({ code: 'REWARD_ALREADY_RESOLVED' });
  });

  it('двойной отзыв возвращает quantity один раз; отозванный приз можно переразыграть тому же победителю (REQ-RWD-007/003)', async () => {
    const { org, room, prize } = await seedPrize(1);
    const winner = await guest();
    await outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, winner.id)]));
    const award = await db.prisma.award.findFirstOrThrow({ where: { roomId: room.id } });
    await rewards.revoke(room.id, award.id, org.id);
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(1);
    const again = await rewards.revoke(room.id, award.id, org.id); // no-op
    expect(again.status).toBe('REVOKED');
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(1);
    // Место освобождено: повторное награждение того же победителя тем же призом проходит.
    await outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, winner.id)]));
    expect(await db.prisma.award.count({ where: { prizeId: prize.id, status: 'AWARDED' } })).toBe(1);
    expect((await db.prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).quantity).toBe(0);
  });

  it('award.points: ledger-запись без приза и фонда, события нет (design §5)', async () => {
    const { room } = await seedPrize(0);
    const p = await guest();
    await outbox.run((tx) =>
      rewards.executeEffects(tx, room.id, 'quiz', [{ kind: 'award.points', identityId: p.id, points: 900, reason: 'quiz.round' }]),
    );
    const grants = await db.prisma.pointsGrant.findMany({ where: { roomId: room.id } });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ identityId: p.id, points: 900, reason: 'quiz.round', sourceAppId: 'quiz' });
  });

  it('отказ эффекта откатывает транзакцию целиком — награды и события нет (подход A)', async () => {
    const { room } = await seedPrize(1);
    const winner = await guest();
    await expect(
      outbox.run((tx) =>
        rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(crypto.randomUUID(), winner.id)]),
      ),
    ).rejects.toMatchObject({ code: 'PRIZE_UNKNOWN' });
    expect(await db.prisma.award.count({ where: { roomId: room.id } })).toBe(0);
    expect(await db.prisma.logEvent.count({ where: { roomId: room.id } })).toBe(0);
  });
});
```

Примечание к последнему тесту: `logEvent` — клиентское имя модели лога; сверить с schema.prisma (`realtime."LogEvent"` → `prisma.logEvent`).

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test:int -- rewards.int-spec`
Expected: FAIL (RewardsModule не существует — компиляция).

- [ ] **Step 3: Implement**

`packages/core/src/rewards/rewards.errors.ts`:

```typescript
import { ContractError } from '@mymozhem/sdk';

// Типизированные отказы контура rewards (design 2026-09-10 §3). Wire-маппинг —
// HttpExceptionFilter (Task 6); над socket — ack с {code} (REQ-SEC-006).
export class PrizeUnknownError extends ContractError {
  constructor(prizeId: string) {
    super('PRIZE_UNKNOWN', `no prize ${prizeId} in this room`);
  }
}

export class PrizeFundExhaustedError extends ContractError {
  constructor(prizeId: string) {
    super('PRIZE_FUND_EXHAUSTED', `prize fund of ${prizeId} is exhausted`);
  }
}

export class AwardUnknownError extends ContractError {
  constructor(awardId: string) {
    super('AWARD_UNKNOWN', `no award ${awardId} in this room`);
  }
}

export class RewardAlreadyResolvedError extends ContractError {
  constructor(awardId: string, status: string) {
    super('REWARD_ALREADY_RESOLVED', `award ${awardId} is already ${status}`);
  }
}
```

`packages/core/src/rewards/rewards.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AppEffect, CreatePrizeRequest } from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipService } from '../membership/membership.service';
import { ActorNotOrganizerError, ActorNotMemberError } from '../membership/membership.errors';
import { EventLogService } from '../realtime/event-log.service';
import { EventOutbox } from '../realtime/event-outbox';
import { RoomNotActiveError } from '../realtime/realtime.errors';
import {
  AwardUnknownError,
  PrizeFundExhaustedError,
  PrizeUnknownError,
  RewardAlreadyResolvedError,
} from './rewards.errors';

// Контур rewards (design 2026-09-10 §2/§3). Два входа:
// 1) executeEffects — из диспетчера app-runtime, ВНУТРИ его outbox.run (вложенный
//    run запрещён — поэтому tx приходит параметром); отказ → откат всей транзакции.
// 2) REST-методы (createPrize/listAwards/fulfill/revoke) — свои outbox.run.
// События rewards.* коммитятся в той же транзакции (лог — нотификация и аудит,
// ADR-005; таблицы остаются источником состояния).
@Injectable()
export class RewardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
    private readonly eventLog: EventLogService,
    private readonly outbox: EventOutbox,
  ) {}

  // --- Вход 1: эффекты из app-runtime (чужая транзакция) ---

  async executeEffects(
    tx: Prisma.TransactionClient,
    roomId: string,
    sourceAppId: string,
    effects: readonly AppEffect[],
  ): Promise<void> {
    for (const effect of effects) {
      if (effect.kind === 'award.prize') {
        await this.awardPrize(tx, roomId, sourceAppId, effect.prizeId, effect.winnerId);
      } else {
        await tx.pointsGrant.create({
          data: {
            roomId,
            identityId: effect.identityId,
            points: effect.points,
            reason: effect.reason ?? null,
            sourceAppId,
          },
        });
      }
    }
  }

  // Порядок «insert Award → декремент» (не наоборот): конфликт частичного индекса
  // — типизированный no-op (REQ-RWD-003), и он НЕ должен списывать фонд; отказ
  // декремента откатывает insert вместе со всей транзакцией (REQ-RWD-010).
  private async awardPrize(
    tx: Prisma.TransactionClient,
    roomId: string,
    sourceAppId: string,
    prizeId: string,
    winnerId: string,
  ): Promise<void> {
    const prize = await tx.prize.findFirst({ where: { id: prizeId, roomId } });
    if (!prize) throw new PrizeUnknownError(prizeId);
    let awardId: string;
    try {
      const award = await tx.award.create({
        data: { roomId, prizeId, winnerId, sourceAppId },
      });
      awardId = award.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return; // сетевой повтор того же награждения — типизированный no-op
      }
      throw err;
    }
    const decremented = await tx.$executeRaw`
      UPDATE rewards."Prize" SET quantity = quantity - 1, "updatedAt" = now()
      WHERE id = ${prizeId}::uuid AND quantity >= 1`;
    if (decremented === 0) throw new PrizeFundExhaustedError(prizeId); // откатит insert
    await this.eventLog.commitRewardsEvent(tx, roomId, 'reward.awarded', {
      awardId,
      prizeId,
      winnerId,
      sourceAppId,
    });
  }

  // --- Вход 2: REST-контур организатора ---

  async createPrize(roomId: string, actorId: string, input: CreatePrizeRequest) {
    await this.assertOrganizer(roomId, actorId);
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    // Добавление призов — в не-терминальной комнате (design §2: призы добавляют
    // на ходу; fulfill/revoke при COMPLETED — отдельная норма REQ-RWD-009).
    if (!room || room.deletedAt !== null || (room.status !== 'DRAFT' && room.status !== 'ACTIVE')) {
      throw new RoomNotActiveError(`room ${roomId} does not accept new prizes`);
    }
    return this.prisma.prize.create({
      data: { roomId, name: input.name, quantity: input.quantity, quantityTotal: input.quantity },
    });
  }

  async listAwards(roomId: string, actorId: string) {
    await this.assertOrganizer(roomId, actorId);
    // REQ-RWD-009: организатор видит все награды, включая оставшиеся AWARDED
    // при COMPLETED — статус комнаты здесь сознательно не гейтится.
    return this.prisma.award.findMany({ where: { roomId }, orderBy: { createdAt: 'asc' } });
  }

  async fulfill(roomId: string, awardId: string, actorId: string) {
    return this.outbox.run(async (tx) => {
      await this.assertOrganizer(roomId, actorId, tx);
      const award = await tx.award.findFirst({ where: { id: awardId, roomId } });
      if (!award) throw new AwardUnknownError(awardId);
      if (award.status === 'FULFILLED') return award; // типизированный no-op (REQ-RWD-007)
      if (award.status !== 'AWARDED') throw new RewardAlreadyResolvedError(awardId, award.status);
      const n = await tx.$executeRaw`
        UPDATE rewards."Award" SET status = 'FULFILLED', "fulfilledAt" = now()
        WHERE id = ${awardId}::uuid AND status = 'AWARDED'`;
      if (n === 0) return tx.award.findUniqueOrThrow({ where: { id: awardId } }); // гонка — перечитать
      await this.eventLog.commitRewardsEvent(tx, roomId, 'reward.fulfilled', { awardId }, actorId);
      return tx.award.findUniqueOrThrow({ where: { id: awardId } });
    });
  }

  async revoke(roomId: string, awardId: string, actorId: string) {
    return this.outbox.run(async (tx) => {
      await this.assertOrganizer(roomId, actorId, tx);
      const award = await tx.award.findFirst({ where: { id: awardId, roomId } });
      if (!award) throw new AwardUnknownError(awardId);
      if (award.status === 'REVOKED') return award; // no-op: quantity НЕ возвращаем повторно
      if (award.status !== 'AWARDED') throw new RewardAlreadyResolvedError(awardId, award.status);
      const n = await tx.$executeRaw`
        UPDATE rewards."Award" SET status = 'REVOKED', "revokedAt" = now()
        WHERE id = ${awardId}::uuid AND status = 'AWARDED'`;
      if (n === 0) return tx.award.findUniqueOrThrow({ where: { id: awardId } }); // гонка
      // Возврат quantity — только если переход состоялся (двойной отзыв не
      // возвращает quantity дважды, REQ-RWD-007); у безпризовой награды возвращать нечего.
      if (award.prizeId !== null) {
        await tx.$executeRaw`
          UPDATE rewards."Prize" SET quantity = quantity + 1, "updatedAt" = now()
          WHERE id = ${award.prizeId}::uuid`;
      }
      await this.eventLog.commitRewardsEvent(tx, roomId, 'reward.revoked', { awardId }, actorId);
      return tx.award.findUniqueOrThrow({ where: { id: awardId } });
    });
  }

  // Проверка роли — в домене, не в транспорте (прецедент MembershipService.exclude).
  private async assertOrganizer(
    roomId: string,
    actorId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const membership = await this.membership.findActiveMembership(roomId, actorId);
    if (!membership) throw new ActorNotMemberError(`identity ${actorId} is not a member of room ${roomId}`);
    if (membership.role !== 'ORGANIZER') throw new ActorNotOrganizerError(`identity ${actorId} is not the organizer of room ${roomId}`);
    void tx; // findActiveMembership читает своим клиентом; tx-вариант — при первой гонке (follow-up)
  }
}
```

Примечание исполнителю: точные имена/сигнатуры `ActorNotMemberError`/`ActorNotOrganizerError` и аргументы `findActiveMembership` сверить с `membership/membership.errors.ts` и `membership.service.ts:64-71`; если `findActiveMembership` не принимает tx — вызов как есть (прецедент exclude делает проверку вне tx). Если assertOrganizer остаётся одноклиентным — параметр tx убрать, отразить в леджере.

`rewards.module.ts` (контроллер — Task 6, handler-провайдер и @Global — Task 11):

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MembershipModule } from '../membership/membership.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RewardsService } from './rewards.service';

@Module({
  imports: [PrismaModule, MembershipModule, RealtimeModule],
  providers: [RewardsService],
  exports: [RewardsService],
})
export class RewardsModule {}
```

`event-log.service.ts` — refactor к общему пути (тела `commitCoreEvent` заменить делегированием; поведение не меняется):

```typescript
  async commitCoreEvent(
    tx: Prisma.TransactionClient,
    roomId: string,
    name: CoreEventName,
    payload: unknown = {},
    actorId: string | null = null,
  ): Promise<LogEvent> {
    return this.commitStaticEvent(tx, roomId, coreEventType(name), CORE_EVENTS[name], payload, actorId);
  }

  // События контура rewards (design 2026-09-10 §2): тот же статический путь, что
  // core.*, — реестр REWARDS_EVENTS core-owned, клиентский publish закрыт в gateway
  // (namespace 'rewards' не зарегистрирован как appId → EVENT_UNKNOWN_TYPE).
  async commitRewardsEvent(
    tx: Prisma.TransactionClient,
    roomId: string,
    name: RewardsEventName,
    payload: unknown = {},
    actorId: string | null = null,
  ): Promise<LogEvent> {
    return this.commitStaticEvent(tx, roomId, rewardsEventType(name), REWARDS_EVENTS[name], payload, actorId);
  }

  private async commitStaticEvent(
    tx: Prisma.TransactionClient,
    roomId: string,
    type: string,
    definition: EventTypeDefinition,
    payload: unknown,
    actorId: string | null,
  ): Promise<LogEvent> {
    const parsed = definition.schema.safeParse(payload);
    if (!parsed.success) {
      throw new ContractError(
        'EVENT_PAYLOAD_INVALID',
        `payload of ${type} does not match its core schema`,
      );
    }
    return this.appendLocked(tx, roomId, type, parsed.data, actorId, definition.visibility, definition.version);
  }
```

Импорты `REWARDS_EVENTS, RewardsEventName, rewardsEventType, EventTypeDefinition` из `@mymozhem/sdk`.

Barrel `packages/core/src/index.ts` += `export * from './rewards/rewards.module';`, `export * from './rewards/rewards.service';`, `export * from './rewards/rewards.errors';` (и `./rewards/rewards.controller` в Task 6).

- [ ] **Step 4: Run — GREEN**

Run: `pnpm --filter @mymozhem/sdk build && pnpm --filter @mymozhem/core test:int -- rewards`
Expected: PASS обоих int-файлов (rewards-schema, rewards). Затем `pnpm build && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core test:int` — регрессий нет (refactor commitCoreEvent накрыт существующими спеками event-commit/realtime).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rewards packages/core/src/realtime packages/core/src/index.ts
git commit -m "feat(core): RewardsService — эффекты награждения в транзакции коммита, автомат AWARDED→FULFILLED|REVOKED, commitRewardsEvent

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

