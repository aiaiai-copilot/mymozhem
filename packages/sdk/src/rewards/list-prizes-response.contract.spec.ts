import { listPrizesResponseSchema } from './list-prizes-response';

// zod v4 z.uuid() требует RFC 9562 version nibble — как в create-room-response.contract.spec.
const UUID = '00000000-0000-4000-8000-000000000001';
const prize = {
  id: UUID,
  roomId: UUID,
  name: 'iPhone',
  quantityTotal: 3,
  quantity: 2,
  createdAt: '2026-09-10T12:00:00.000Z',
  updatedAt: '2026-09-10T12:00:00.000Z',
};

describe('listPrizesResponse contract (UI-срез §2)', () => {
  it.each([
    ['valid — один приз', { prizes: [prize] }, true],
    ['valid — пустой массив', { prizes: [] }, true],
    ['extra key rejected', { prizes: [], extra: 1 }, false],
    ['prize entry with extra key rejected', { prizes: [{ ...prize, extra: 1 }] }, false],
    ['prize entry missing quantity', { prizes: [{ id: UUID, roomId: UUID, name: 'iPhone', quantityTotal: 3, createdAt: '2026-09-10T12:00:00.000Z', updatedAt: '2026-09-10T12:00:00.000Z' }] }, false],
  ])('%s', (_l, body, ok) => {
    expect(listPrizesResponseSchema.safeParse(body).success).toBe(ok);
  });
});
