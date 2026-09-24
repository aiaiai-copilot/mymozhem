import { randomUUID } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import type { AppEffect } from '@mymozhem/sdk';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { AppRuntimeModule } from '../app-runtime/app-runtime.module';
import { AuthModule } from '../auth/auth.module';
import { TokenService } from '../auth/token.service';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG } from '../config/config.tokens';
import { MembershipModule } from '../membership/membership.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { EventOutbox } from '../realtime/event-outbox';
import { RealtimeModule } from '../realtime/realtime.module';
import { RewardsAnonymizationGuard } from '../rewards/rewards-anonymization.guard';
import { RewardsModule } from '../rewards/rewards.module';
import { RewardsService } from '../rewards/rewards.service';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { TEST_CONFIG } from '../testing/test-config';
import { ANONYMIZATION_GUARDS, type AnonymizationGuard } from './anonymization-guards';
import { GuestSweepService } from './guest-sweep.service';
import { IdentityModule } from './identity.module';

// Бутстрап — по образцу rewards.int-spec.ts (Task 5): DI-контейнер, startTestDb()
// ДО compile() (PrismaService читает DATABASE_URL при конструировании), TEST_CONFIG
// через overrideProvider (GUEST_TTL = 86400 с — backdate на 25 ч делает гостя expired).
// IdentitySweepModule здесь НЕ импортируется: расписание — composition root (Task 11),
// логика свипа покрывается прямым вызовом sweepExpiredGuests.

// Связка ANONYMIZATION_GUARDS — миниатюра composition root (Task 11): identity не
// импортирует rewards (REQ-RWD-001), массив гардов из экспортированного провайдера
// собирает глобальный wiring-модуль (@Global — единственный способ дотянуться из
// IdentityModule без обратного импорта: DI-резолюция ограничена скоупом модуля).
@Global()
@Module({
  imports: [RewardsModule],
  providers: [
    {
      provide: ANONYMIZATION_GUARDS,
      useFactory: (guard: RewardsAnonymizationGuard): AnonymizationGuard[] => [guard],
      inject: [RewardsAnonymizationGuard],
    },
  ],
  exports: [ANONYMIZATION_GUARDS],
})
class TestAnonymizationWiringModule {}

const TRUNCATE =
  'TRUNCATE TABLE rewards."PointsGrant", rewards."Award", rewards."Prize", identity."Session", membership."Membership", room."Room" CASCADE';

describe('GuestSweepService (int, REQ-ID-003/014)', () => {
  let db: TestDb;
  let sweep: GuestSweepService;
  let tokens: TokenService;

  beforeAll(async () => {
    db = await startTestDb();
    const moduleRef = await Test.createTestingModule({
      // RewardsModule сознательно НЕ подключён: гардов нет, приостанавливать некому
      // (ветка REQ-RWD-001 — identity работает без rewards).
      imports: [ConfigModule, PrismaModule, IdentityModule, AuthModule],
    })
      // ConfigModule читает process.env — в int-лайне подменяем инертным конфигом.
      .overrideProvider(APP_CONFIG)
      .useValue(TEST_CONFIG)
      .compile();
    await moduleRef.init();
    sweep = moduleRef.get(GuestSweepService);
    tokens = moduleRef.get(TokenService);
  }, 120_000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(TRUNCATE);
  });

  // seedIdentity не принимает displayName (контракт хелпера) — PII выставляем прямым
  // апдейтом; createdAt бэкдейтим за GUEST_TTL (86400 с) сырым SQL.
  async function expiredGuest(displayName: string, email?: string) {
    const guest = await seedIdentity(db.prisma, { kind: 'GUEST', email: email ?? null });
    await db.prisma.identity.update({ where: { id: guest.id }, data: { displayName } });
    await db.prisma.$executeRaw`UPDATE identity."Identity" SET "createdAt" = now() - interval '25 hours' WHERE id = ${guest.id}::uuid`;
    return guest;
  }

  it('гость с истёкшим TTL анонимизируется: displayName/email → NULL, deletedAt выставлен, живые сессии отозваны', async () => {
    const guest = await expiredGuest('Гость Свипа', `guest-${randomUUID()}@example.test`);
    await tokens.issueGuestTokens(guest.id, randomUUID());

    const anonymized = await sweep.sweepExpiredGuests();

    expect(anonymized).toBe(1);
    const after = await db.prisma.identity.findUniqueOrThrow({ where: { id: guest.id } });
    expect(after.id).toBe(guest.id); // анонимизация, не удаление (REQ-ID-014)
    expect(after.displayName).toBeNull();
    expect(after.email).toBeNull();
    expect(after.deletedAt).not.toBeNull();
    const sessions = await db.prisma.session.findMany({ where: { identityId: guest.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].revokedAt).not.toBeNull();
  });

  it('гость с неистёкшим TTL и REGISTERED с истёкшим не тронуты', async () => {
    const freshGuest = await seedIdentity(db.prisma, { kind: 'GUEST' });
    const registered = await seedIdentity(db.prisma, {
      kind: 'REGISTERED',
      email: `reg-${randomUUID()}@example.test`,
    });
    await db.prisma.$executeRaw`UPDATE identity."Identity" SET "createdAt" = now() - interval '25 hours' WHERE id = ${registered.id}::uuid`;

    await sweep.sweepExpiredGuests();

    const guestAfter = await db.prisma.identity.findUniqueOrThrow({ where: { id: freshGuest.id } });
    expect(guestAfter.deletedAt).toBeNull();
    const regAfter = await db.prisma.identity.findUniqueOrThrow({ where: { id: registered.id } });
    expect(regAfter.deletedAt).toBeNull();
    expect(regAfter.email).toBe(registered.email);
  });

  it('без подключённых гардов приостановки нет (rewards не подключён — REQ-RWD-001)', async () => {
    const guest = await expiredGuest('Гость Без Гардов');
    // Открытая награда напрямую в БД — sweep её не видит: гард не зарегистрирован.
    const org = await seedIdentity(db.prisma, { email: `org-${randomUUID()}@example.test` });
    const room = await db.prisma.room.create({
      data: { code: randomUUID().slice(0, 8).toUpperCase(), organizerId: org.id },
    });
    const prize = await db.prisma.prize.create({
      data: { roomId: room.id, name: 'Приз', quantityTotal: 1, quantity: 1 },
    });
    await db.prisma.award.create({
      data: { roomId: room.id, prizeId: prize.id, winnerId: guest.id, status: 'AWARDED', sourceAppId: 'lottery' },
    });

    const anonymized = await sweep.sweepExpiredGuests();

    expect(anonymized).toBe(1);
    const after = await db.prisma.identity.findUniqueOrThrow({ where: { id: guest.id } });
    expect(after.deletedAt).not.toBeNull();
  });
});

describe('GuestSweepService — приостановка при открытой награде (REQ-RWD-013)', () => {
  let db: TestDb;
  let sweep: GuestSweepService;
  let rewards: RewardsService;
  let outbox: EventOutbox;

  beforeAll(async () => {
    db = await startTestDb();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        PrismaModule,
        AppRegistryModule.register([]),
        // RealtimeGateway (провайдер RealtimeModule) разрешает AppRuntimeService
        // через global-провайдер — без register DI не собирается.
        AppRuntimeModule.register([]),
        MembershipModule,
        RealtimeModule,
        RewardsModule,
        IdentityModule,
        TestAnonymizationWiringModule,
      ],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(TEST_CONFIG)
      .compile();
    await moduleRef.init();
    sweep = moduleRef.get(GuestSweepService);
    rewards = moduleRef.get(RewardsService);
    outbox = moduleRef.get(EventOutbox);
  }, 120_000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(TRUNCATE);
  });

  async function expiredGuest(displayName: string) {
    const guest = await seedIdentity(db.prisma, { kind: 'GUEST' });
    await db.prisma.identity.update({ where: { id: guest.id }, data: { displayName } });
    await db.prisma.$executeRaw`UPDATE identity."Identity" SET "createdAt" = now() - interval '25 hours' WHERE id = ${guest.id}::uuid`;
    return guest;
  }

  // Хелпер продублирован из rewards.int-spec.ts (бриф Task 8): комната DRAFT с
  // организатором (membership нужен assertOrganizer в fulfill/revoke) + приз с фондом.
  async function seedPrize(quantity: number) {
    const org = await seedIdentity(db.prisma, { email: `org-${randomUUID()}@example.test` });
    const room = await db.prisma.room.create({
      data: { code: randomUUID().slice(0, 8).toUpperCase(), organizerId: org.id },
    });
    await db.prisma.membership.create({
      data: { roomId: room.id, identityId: org.id, role: 'ORGANIZER' },
    });
    const prize = await db.prisma.prize.create({
      data: { roomId: room.id, name: 'Приз', quantityTotal: quantity, quantity },
    });
    return { org, room, prize };
  }
  const prizeEffect = (prizeId: string, winnerId: string): AppEffect => ({
    kind: 'award.prize',
    prizeId,
    winnerId,
  });

  it('гость с открытой AWARDED не анонимизируется; после fulfill/revoke — анонимизируется следующим проходом', async () => {
    const { org, room, prize } = await seedPrize(2);

    // Ветка fulfill: открытая награда приостанавливает свип.
    const guest1 = await expiredGuest('Гость-победитель 1');
    await outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, guest1.id)]));
    expect(await sweep.sweepExpiredGuests()).toBe(0);
    let after = await db.prisma.identity.findUniqueOrThrow({ where: { id: guest1.id } });
    expect(after.deletedAt).toBeNull();
    expect(after.displayName).toBe('Гость-победитель 1');
    const award1 = await db.prisma.award.findFirstOrThrow({ where: { winnerId: guest1.id } });
    await rewards.fulfill(room.id, award1.id, org.id);
    expect(await sweep.sweepExpiredGuests()).toBe(1);
    after = await db.prisma.identity.findUniqueOrThrow({ where: { id: guest1.id } });
    expect(after.deletedAt).not.toBeNull();
    expect(after.displayName).toBeNull();

    // Ветка revoke: то же через отзыв.
    const guest2 = await expiredGuest('Гость-победитель 2');
    await outbox.run((tx) => rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(prize.id, guest2.id)]));
    expect(await sweep.sweepExpiredGuests()).toBe(0);
    after = await db.prisma.identity.findUniqueOrThrow({ where: { id: guest2.id } });
    expect(after.deletedAt).toBeNull();
    const award2 = await db.prisma.award.findFirstOrThrow({ where: { winnerId: guest2.id } });
    await rewards.revoke(room.id, award2.id, org.id);
    expect(await sweep.sweepExpiredGuests()).toBe(1);
    after = await db.prisma.identity.findUniqueOrThrow({ where: { id: guest2.id } });
    expect(after.deletedAt).not.toBeNull();
  });
});

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
      // PrismaModule нужен прямо: он не @Global, а RewardsModule не ре-экспортирует
      // PrismaService — без imports фабрика не разрешит PrismaService в этом скоупе.
      imports: [RewardsModule, PrismaModule],
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
