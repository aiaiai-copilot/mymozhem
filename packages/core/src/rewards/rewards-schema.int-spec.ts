import { randomUUID } from 'node:crypto';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';

// REQ-DEV-006 (автотест наличия рукописных частей миграции), REQ-RWD-003
// (частичный уникальный индекс единичности победителя), REQ-RWD-010 (CHECK
// неотрицательности призового фонда + ограниченный декремент).
describe('rewards schema (REQ-DEV-006, REQ-RWD-003/010)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 120_000);

  afterAll(async () => {
    await db.stop();
  });

  it('has the partial unique index on active awards (REQ-RWD-003)', async () => {
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

  // Сиды комнаты/приза/победителя. Значения уникальны на вызов: тесты делят одну
  // testcontainer-БД, фиксированные email/код комнаты конфликтовали бы по P2002.
  async function seedRoomPrizeWinner() {
    const org = await seedIdentity(db.prisma, {
      email: `org-${randomUUID()}@example.test`,
    });
    const winner = await seedIdentity(db.prisma, { kind: 'GUEST' });
    const room = await db.prisma.room.create({
      data: { code: randomUUID().slice(0, 8).toUpperCase(), organizerId: org.id },
    });
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
    await db.prisma.award.update({
      where: { id: first.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    const second = await db.prisma.award.create({
      data: { roomId: room.id, prizeId: prize.id, winnerId: winner.id, sourceAppId: 'lottery' },
    });
    // FULFILLED — нет: слот по-прежнему занят.
    await db.prisma.award.update({
      where: { id: second.id },
      data: { status: 'FULFILLED', fulfilledAt: new Date() },
    });
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
