import { createPrizeRequestSchema } from './create-prize-request';
import { awardResponseSchema } from './award-response';
import { listRewardsResponseSchema } from './list-rewards-response';
import { prizeResponseSchema } from './prize-response';

const UUID = '3f6b2b6e-9c5a-4f1e-8b2d-7a9c1e0f2a3b';

describe('rewards REST DTO', () => {
  it('accepts a valid createPrize request', () => {
    expect(createPrizeRequestSchema.safeParse({ name: 'iPhone', quantity: 3 }).success).toBe(true);
  });
  it.each([
    { name: '', quantity: 1 }, // пустое имя
    { name: 'iPhone', quantity: 0 }, // неположительный фонд
    { name: 'iPhone', quantity: 1.5 }, // не int
    { name: 'iPhone', quantity: 1, extra: true }, // strictObject
  ])('rejects %j', (v) => {
    expect(createPrizeRequestSchema.safeParse(v).success).toBe(false);
  });

  it('parses award/prize/list responses', () => {
    const award = {
      id: UUID, roomId: UUID, prizeId: null, winnerId: UUID,
      status: 'AWARDED', sourceAppId: 'lottery',
      createdAt: '2026-09-10T12:00:00.000Z', fulfilledAt: null, revokedAt: null,
    };
    expect(awardResponseSchema.safeParse(award).success).toBe(true);
    expect(listRewardsResponseSchema.safeParse({ awards: [award] }).success).toBe(true);
    const prize = { id: UUID, roomId: UUID, name: 'iPhone', quantityTotal: 3, quantity: 2, createdAt: '2026-09-10T12:00:00.000Z', updatedAt: '2026-09-10T12:00:00.000Z' };
    expect(prizeResponseSchema.safeParse(prize).success).toBe(true);
  });

  it('rejects unknown award status', () => {
    const award = { id: UUID, roomId: UUID, prizeId: null, winnerId: UUID, status: 'CLAIMED', sourceAppId: 'lottery', createdAt: '2026-09-10T12:00:00.000Z', fulfilledAt: null, revokedAt: null };
    expect(awardResponseSchema.safeParse(award).success).toBe(false); // CLAIMED отложен (ADR-007)
  });
});
