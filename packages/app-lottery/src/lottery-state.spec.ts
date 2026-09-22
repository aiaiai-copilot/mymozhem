import type { AppLogEvent } from '@mymozhem/sdk';
import { initialLotteryState, reduceLottery } from './lottery-state';

// Проекция лотереи (REQ-CORE-004): редьюсер чистый, payload'ы не перевалидируются
// (реестр проверил их до коммита в лог); дедупликация по drawId — идемпотентность
// replay/live-дублей (REQ-RWD-003, design §4).
const ACTOR = '0f8fad5b-d9cb-469f-a165-70867728950e';

const D1 = 'd1e1f1a2-0002-4a02-8002-000000000002';
const P1 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const W1 = 'a3a8d3e1-9e5b-4f1c-8a2b-3c4d5e6f7081';
const W2 = 'b4b9e4f2-af6c-402d-9b3c-4d5e6f708192';

function event(
  shortName: string,
  payload: Record<string, unknown>,
  overrides: Partial<AppLogEvent> = {},
): AppLogEvent {
  return {
    shortName,
    payload,
    actorId: ACTOR,
    seq: 1,
    recordedAt: '2026-09-09T12:00:00.000Z',
    ...overrides,
  };
}

describe('reduceLottery', () => {
  it('draw.completed добавляет запись; повтор того же drawId — no-op (идемпотентность replay/live)', () => {
    const s0 = initialLotteryState();
    const e = event('draw.completed', { drawId: D1, prizeId: P1, winnerId: W1 });
    const s1 = reduceLottery(s0, e);
    expect(s1.draws[D1]).toEqual({ prizeId: P1, winnerId: W1 });
    expect(reduceLottery(s1, e)).toBe(s1); // та же ссылка — ничего не изменилось
    expect(
      reduceLottery(s1, event('draw.completed', { drawId: D1, prizeId: P1, winnerId: W2 })).draws[D1].winnerId,
    ).toBe(W1);
  });

  it('неизвестный тип — no-op; состояние иммутабельно', () => {
    const s0 = initialLotteryState();
    expect(reduceLottery(s0, event('something.else', {}))).toBe(s0);
  });
});
