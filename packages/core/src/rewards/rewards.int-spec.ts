import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { AppEffect } from '@mymozhem/sdk';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { AppRuntimeModule } from '../app-runtime/app-runtime.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG } from '../config/config.tokens';
import { MembershipModule } from '../membership/membership.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { EventOutbox } from '../realtime/event-outbox';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { TEST_CONFIG } from '../testing/test-config';
import { RewardsModule } from './rewards.module';
import { RewardsService } from './rewards.service';
import { PrizeFundExhaustedError } from './rewards.errors';

// REQ-RWD-003 (атомарность, идемпотентный no-op по частичному индексу),
// REQ-RWD-007 (автомат награды, идемпотентные переходы), REQ-RWD-010
// (ограниченный декремент фонда), REQ-RWD-002b (award.points без приза),
// REQ-SEC-009 (payload событий — только id).
// Бутстрап — DI-контейнер (прецедент рулинга Quiz-среза: сервис через контейнер).
// startTestDb() вызывается ДО compile(): PrismaService читает DATABASE_URL при
// конструировании — контейнерный клиент должен смотреть в testcontainer.
describe('RewardsService (int)', () => {
  let db: TestDb;
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
      ],
    })
      // ConfigModule читает process.env — в int-лайне подменяем инертным конфигом.
      .overrideProvider(APP_CONFIG)
      .useValue(TEST_CONFIG)
      .compile();
    await moduleRef.init();
    rewards = moduleRef.get(RewardsService);
    outbox = moduleRef.get(EventOutbox);
  }, 120_000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE rewards."PointsGrant", rewards."Award", rewards."Prize", identity."Session", membership."Membership", room."Room" CASCADE',
    );
  });

  // Хелпер: комната DRAFT с организатором (membership нужен assertOrganizer в
  // fulfill/revoke) + приз с фондом quantity. Значения уникальны на вызов:
  // тесты делят одну testcontainer-БД, identity не транкейтится.
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
  const guest = () => seedIdentity(db.prisma, { kind: 'GUEST' });
  const prizeEffect = (prizeId: string, winnerId: string): AppEffect => ({
    kind: 'award.prize',
    prizeId,
    winnerId,
  });

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
    const award = await db.prisma.award.findFirstOrThrow({ where: { roomId: room.id } });
    const done1 = await rewards.fulfill(room.id, award.id, org.id);
    const done2 = await rewards.fulfill(room.id, award.id, org.id);
    expect(done2.status).toBe('FULFILLED');
    expect(done2.fulfilledAt).toEqual(done1.fulfilledAt);
    await expect(rewards.revoke(room.id, award.id, org.id)).rejects.toMatchObject({
      code: 'REWARD_ALREADY_RESOLVED',
    });
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
      rewards.executeEffects(tx, room.id, 'quiz', [
        { kind: 'award.points', identityId: p.id, points: 900, reason: 'quiz.round' },
      ]),
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
        rewards.executeEffects(tx, room.id, 'lottery', [prizeEffect(randomUUID(), winner.id)]),
      ),
    ).rejects.toMatchObject({ code: 'PRIZE_UNKNOWN' });
    expect(await db.prisma.award.count({ where: { roomId: room.id } })).toBe(0);
    expect(await db.prisma.logEvent.count({ where: { roomId: room.id } })).toBe(0);
  });
});
