import {
  AppRejection,
  type AppHostContext,
  type ContractErrorCode,
} from '@mymozhem/sdk';
import { handleLotteryPublish } from './lottery-handlers';
import { createLotteryApp, createLotteryRuntime } from './lottery-runtime';
import { buildLotteryManifest, LOTTERY_APP_ID, LOTTERY_MANIFEST_VERSION } from './lottery-manifest';
import { initialLotteryState, type LotteryState } from './lottery-state';

// Командный handler розыгрыша: ролевой гейт (только ORGANIZER), выбор победителя
// только через ctx.randomInt (REQ-RWD-011), eligibility-фильтр пула (REQ-RWD-014),
// идемпотентность по drawId на уровне app-команды (REQ-RWD-003, design §4).

const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e';

const D0 = 'd0e0f0a1-0001-4a01-8001-000000000001';
const D1 = 'd1e1f1a2-0002-4a02-8002-000000000002';
const P1 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const W1 = 'a3a8d3e1-9e5b-4f1c-8a2b-3c4d5e6f7081';
const W2 = 'b4b9e4f2-af6c-402d-9b3c-4d5e6f708192';
const W3 = 'c5caf503-b07d-413e-ac4d-5e6f708192a3';

const ctx = (over: Partial<AppHostContext<LotteryState>>): AppHostContext<LotteryState> => ({
  roomId: 'r',
  actorId: ORG,
  actorRole: 'ORGANIZER',
  settings: {},
  state: initialLotteryState(),
  now: '2026-09-09T12:00:00.000Z',
  randomInt: () => 0,
  drawPool: [],
  ...over,
});

const rejection = (fn: () => unknown): AppRejection => {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppRejection) {
      return e;
    }
    throw e;
  }
  throw new Error('expected AppRejection');
};

const expectRejection = (fn: () => unknown, code: ContractErrorCode): void => {
  expect(rejection(fn).code).toBe(code);
};

describe('handleLotteryPublish draw.run', () => {
  const POOL = [
    { identityId: W1, kind: 'GUEST' as const },
    { identityId: W2, kind: 'GUEST' as const },
    { identityId: W3, kind: 'REGISTERED' as const },
  ];

  it('организатор разыгрывает приз: echo + draw.completed + эффект award.prize', () => {
    const result = handleLotteryPublish(ctx({ actorRole: 'ORGANIZER', drawPool: POOL }), 'draw.run', {
      drawId: D1,
      prizeId: P1,
    });
    expect(result).toEqual({
      commits: [
        { shortName: 'draw.run', payload: { drawId: D1, prizeId: P1 }, visibility: 'public', actor: 'publisher' },
        {
          shortName: 'draw.completed',
          payload: { drawId: D1, prizeId: P1, winnerId: W1 },
          visibility: 'public',
          actor: 'server',
        },
      ],
      effects: [{ kind: 'award.prize', prizeId: P1, winnerId: W1 }],
    });
  });

  it('не-организатор → PUBLISH_FORBIDDEN', () => {
    expectRejection(
      () => handleLotteryPublish(ctx({ actorRole: 'PARTICIPANT', drawPool: POOL }), 'draw.run', { drawId: D1, prizeId: P1 }),
      'PUBLISH_FORBIDDEN',
    );
  });

  it('повтор drawId → no-op с прежним результатом: re-emit draw.completed, БЕЗ эффекта (дизайн §4 п.2)', () => {
    const state = { draws: { [D1]: { prizeId: P1, winnerId: W2 } } };
    const result = handleLotteryPublish(ctx({ actorRole: 'ORGANIZER', drawPool: POOL, state }), 'draw.run', {
      drawId: D1,
      prizeId: P1,
    });
    expect(result).toEqual({
      commits: [
        {
          shortName: 'draw.completed',
          payload: { drawId: D1, prizeId: P1, winnerId: W2 },
          visibility: 'public',
          actor: 'server',
        },
      ],
      effects: [],
    });
  });

  it('пустой пул → DRAW_POOL_EMPTY до коммита', () => {
    expectRejection(
      () => handleLotteryPublish(ctx({ actorRole: 'ORGANIZER', drawPool: [] }), 'draw.run', { drawId: D1, prizeId: P1 }),
      'DRAW_POOL_EMPTY',
    );
  });

  it('verified: гости вне пула — победитель всегда REGISTERED (REQ-RWD-014)', () => {
    const settings = { drawEligibility: 'verified' };
    const result = handleLotteryPublish(
      ctx({ actorRole: 'ORGANIZER', drawPool: POOL, settings }),
      'draw.run',
      { drawId: D1, prizeId: P1 },
    );
    expect(result.commits[1].payload.winnerId).toBe(W3); // единственный REGISTERED
  });

  it('прежний победитель этого приза исключён из пула (UX; индекс — страховка)', () => {
    const state = { draws: { [D0]: { prizeId: P1, winnerId: W1 } } };
    const result = handleLotteryPublish(ctx({ actorRole: 'ORGANIZER', drawPool: POOL, state }), 'draw.run', {
      drawId: D1,
      prizeId: P1,
    });
    expect(result.commits[1].payload.winnerId).toBe(W2); // W1 исключён, randomInt() = 0 → новый pool[0]
  });

  it('выбор идёт через ctx.randomInt — stub возвращает индекс', () => {
    const result = handleLotteryPublish(
      ctx({ actorRole: 'ORGANIZER', drawPool: POOL, randomInt: () => 2 }),
      'draw.run',
      { drawId: D1, prizeId: P1 },
    );
    expect(result.commits[1].payload.winnerId).toBe(W3);
  });

  it('неизвестная команда → EVENT_UNKNOWN_TYPE', () => {
    expectRejection(() => handleLotteryPublish(ctx({}), 'draw.unknown', {}), 'EVENT_UNKNOWN_TYPE');
  });
});

describe('createLotteryRuntime / createLotteryApp', () => {
  it('wires appId, manifestVersion, manifest, initialState and reduce', () => {
    const runtime = createLotteryRuntime();
    expect(runtime.appId).toBe(LOTTERY_APP_ID);
    expect(runtime.manifestVersion).toBe(LOTTERY_MANIFEST_VERSION);
    expect(runtime.manifest).toEqual(buildLotteryManifest());
    expect(runtime.initialState()).toEqual(initialLotteryState());
    const drawn = runtime.reduce(runtime.initialState(), {
      shortName: 'draw.completed',
      payload: { drawId: D1, prizeId: P1, winnerId: W1 },
      actorId: null,
      seq: 1,
      recordedAt: '2026-09-09T12:00:00.000Z',
    });
    expect(drawn.draws[D1]).toEqual({ prizeId: P1, winnerId: W1 });
  });

  it('createLotteryApp returns the manifest and the runtime', () => {
    const app = createLotteryApp();
    expect(app.manifest).toEqual(buildLotteryManifest());
    expect(app.runtime.appId).toBe(LOTTERY_APP_ID);
  });
});
