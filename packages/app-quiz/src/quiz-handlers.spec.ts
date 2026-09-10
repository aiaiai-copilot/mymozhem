import {
  AppRejection,
  type AppCommit,
  type AppHostContext,
  type ContractErrorCode,
} from '@mymozhem/sdk';
import { handleQuizPublish } from './quiz-handlers';
import { createQuizApp, createQuizRuntime } from './quiz-runtime';
import { buildQuizManifest, QUIZ_APP_ID, QUIZ_MANIFEST_VERSION } from './quiz-manifest';
import { initialQuizState, type QuizState } from './quiz-state';
import type { QuizSettings } from './quiz-settings';

// Командные handlers квиза: ролевые гейты (REQ-ID-011), actorId только из ctx
// (REQ-RT-009), анти-бот minAnswerIntervalMs (REQ-RT-013), скоростная шкала и
// dense-rank standings. Payload уже провалидирован диспетчером — handlers его
// не перепроверяют; settings перепарсиваются защитно (дёшево).

const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e';
const P1 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const P2 = 'a3a8d3e1-9e5b-4f1c-8a2b-3c4d5e6f7081';
const P3 = 'b4b9e4f2-af6c-402d-9b3c-4d5e6f708192';
const P4 = 'c5caf503-b07d-413e-ac4d-5e6f708192a3';

const T0 = '2026-09-09T12:00:00.000Z';

const SETTINGS: QuizSettings = {
  questions: [
    { text: 'Q1', options: ['a', 'b', 'c'] },
    { text: 'Q2', options: ['x', 'y'] },
  ],
  correctAnswers: [1, 0],
  minAnswerIntervalMs: 1000,
  scoring: { base: 1000, step: 100 },
};

const ctx = (over: Partial<AppHostContext<QuizState>>): AppHostContext<QuizState> => ({
  roomId: 'r',
  actorId: ORG,
  actorRole: 'ORGANIZER',
  settings: SETTINGS,
  state: initialQuizState(),
  now: T0,
  randomInt: () => 0,
  drawPool: [],
  ...over,
});

// Открытый вопрос qi с openedAt = T0 (если не переопределено).
const openState = (qi = 0, over: Partial<QuizState> = {}): QuizState => ({
  ...initialQuizState(),
  currentQuestion: qi,
  accepting: true,
  openedAt: T0,
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

describe('handleQuizPublish / question.opened', () => {
  it('rejects non-organizer with PUBLISH_FORBIDDEN', () => {
    expectRejection(
      () => handleQuizPublish(ctx({ actorRole: 'PARTICIPANT' }), 'question.opened', { questionIndex: 0 }),
      'PUBLISH_FORBIDDEN',
    );
  });

  it('rejects when game is finished with ROUND_NOT_OPEN', () => {
    expectRejection(
      () =>
        handleQuizPublish(ctx({ state: { ...initialQuizState(), finished: true } }), 'question.opened', {
          questionIndex: 0,
        }),
      'ROUND_NOT_OPEN',
    );
  });

  it('rejects opening a second question while the first is open with ROUND_NOT_OPEN', () => {
    expectRejection(
      () => handleQuizPublish(ctx({ state: openState(0) }), 'question.opened', { questionIndex: 1 }),
      'ROUND_NOT_OPEN',
    );
  });

  it('rejects out-of-range questionIndex with QUESTION_UNKNOWN', () => {
    expectRejection(
      () => handleQuizPublish(ctx({}), 'question.opened', { questionIndex: 2 }),
      'QUESTION_UNKNOWN',
    );
  });

  it('commits question.opened as public/publisher on happy path', async () => {
    const commits = (await handleQuizPublish(ctx({}), 'question.opened', { questionIndex: 1 })) as AppCommit[];
    expect(commits).toEqual([
      { shortName: 'question.opened', payload: { questionIndex: 1 }, visibility: 'public', actor: 'publisher' },
    ]);
  });
});

describe('handleQuizPublish / answer.submitted', () => {
  const submit = (over: Partial<AppHostContext<QuizState>>, payload: Record<string, unknown>) =>
    handleQuizPublish(ctx(over), 'answer.submitted', payload);

  it.each(['ORGANIZER', 'SPECTATOR', 'MODERATOR'] as const)('rejects role %s with PUBLISH_FORBIDDEN', (role) => {
    expectRejection(
      () => submit({ actorRole: role, state: openState(0) }, { questionIndex: 0, optionIndex: 0 }),
      'PUBLISH_FORBIDDEN',
    );
  });

  it('rejects when no question is open with ROUND_NOT_OPEN', () => {
    expectRejection(
      () => submit({ actorRole: 'PARTICIPANT' }, { questionIndex: 0, optionIndex: 0 }),
      'ROUND_NOT_OPEN',
    );
  });

  it('rejects answer for a different questionIndex with QUESTION_UNKNOWN', () => {
    expectRejection(
      () => submit({ actorRole: 'PARTICIPANT', state: openState(0) }, { questionIndex: 1, optionIndex: 0 }),
      'QUESTION_UNKNOWN',
    );
  });

  it('rejects out-of-range optionIndex with OPTION_UNKNOWN', () => {
    expectRejection(
      () => submit({ actorRole: 'PARTICIPANT', state: openState(0) }, { questionIndex: 0, optionIndex: 3 }),
      'OPTION_UNKNOWN',
    );
  });

  it('rejects a repeated answer with ALREADY_ANSWERED (wrong answer burns the attempt too)', () => {
    const state = openState(0, { answers: { [P1]: { optionIndex: 0, seq: 5 } } });
    expectRejection(
      () =>
        submit(
          { actorRole: 'PARTICIPANT', actorId: P1, state, now: '2026-09-09T12:00:02.000Z' },
          { questionIndex: 0, optionIndex: 1 },
        ),
      'ALREADY_ANSWERED',
    );
  });

  it('REQ-RT-013: rejects an answer at interval-1 ms with ANSWER_TOO_FAST', () => {
    expectRejection(
      () =>
        submit(
          { actorRole: 'PARTICIPANT', actorId: P1, state: openState(0), now: '2026-09-09T12:00:00.999Z' },
          { questionIndex: 0, optionIndex: 1 },
        ),
      'ANSWER_TOO_FAST',
    );
  });

  it('REQ-RT-013: accepts an answer at exactly the interval boundary', async () => {
    const commits = (await submit(
      { actorRole: 'PARTICIPANT', actorId: P1, state: openState(0), now: '2026-09-09T12:00:01.000Z' },
      { questionIndex: 0, optionIndex: 1 },
    )) as AppCommit[];
    expect(commits).toHaveLength(2);
  });

  it('REQ-RT-013: minAnswerIntervalMs = 0 disables the control entirely', async () => {
    const settings: QuizSettings = { ...SETTINGS, minAnswerIntervalMs: 0 };
    const commits = (await submit(
      { actorRole: 'PARTICIPANT', actorId: P1, settings, state: openState(0), now: T0 },
      { questionIndex: 0, optionIndex: 1 },
    )) as AppCommit[];
    expect(commits).toHaveLength(2);
  });

  it('accepts when openedAt is null (no open timestamp recorded)', async () => {
    const commits = (await submit(
      { actorRole: 'PARTICIPANT', actorId: P1, state: openState(0, { openedAt: null }), now: T0 },
      { questionIndex: 0, optionIndex: 1 },
    )) as AppCommit[];
    expect(commits).toHaveLength(2);
  });

  it('commits answer.submitted (module-private/publisher) + answer.accepted (public/server) on happy path', async () => {
    const commits = (await submit(
      { actorRole: 'PARTICIPANT', actorId: P1, state: openState(0), now: '2026-09-09T12:00:02.000Z' },
      { questionIndex: 0, optionIndex: 1 },
    )) as AppCommit[];
    expect(commits).toEqual([
      {
        shortName: 'answer.submitted',
        payload: { questionIndex: 0, optionIndex: 1 },
        visibility: 'module-private',
        actor: 'publisher',
      },
      {
        shortName: 'answer.accepted',
        payload: { questionIndex: 0, actorId: P1 },
        visibility: 'public',
        actor: 'server',
      },
    ]);
  });
});

describe('handleQuizPublish / question.closed', () => {
  const close = (over: Partial<AppHostContext<QuizState>>, payload: Record<string, unknown>) =>
    handleQuizPublish(ctx(over), 'question.closed', payload);

  it('rejects non-organizer with PUBLISH_FORBIDDEN', () => {
    expectRejection(
      () => close({ actorRole: 'PARTICIPANT', state: openState(0) }, { questionIndex: 0 }),
      'PUBLISH_FORBIDDEN',
    );
  });

  it('rejects when nothing is open with ROUND_NOT_OPEN', () => {
    expectRejection(() => close({}, { questionIndex: 0 }), 'ROUND_NOT_OPEN');
  });

  it('rejects closing a different questionIndex with ROUND_NOT_OPEN', () => {
    expectRejection(() => close({ state: openState(0) }, { questionIndex: 1 }), 'ROUND_NOT_OPEN');
  });

  it('ranks correct answers by seq: base, base-step, base-2*step; wrong answers get nothing', async () => {
    const state = openState(0, {
      answers: {
        [P1]: { optionIndex: 1, seq: 3 }, // correct, third
        [P2]: { optionIndex: 1, seq: 1 }, // correct, first
        [P3]: { optionIndex: 0, seq: 2 }, // wrong
      },
    });
    const commits = (await close({ state }, { questionIndex: 0 })) as AppCommit[];
    expect(commits).toEqual([
      { shortName: 'question.closed', payload: { questionIndex: 0 }, visibility: 'public', actor: 'publisher' },
      {
        shortName: 'question.revealed',
        payload: {
          questionIndex: 0,
          correctIndex: 1,
          awarded: [
            { actorId: P2, points: 1000 },
            { actorId: P1, points: 900 },
          ],
          totals: [
            { actorId: P2, total: 1000 },
            { actorId: P1, total: 900 },
          ],
        },
        visibility: 'public',
        actor: 'server',
      },
    ]);
  });

  it('merges awarded points into pre-existing totals', async () => {
    const state = openState(0, {
      totals: { [P1]: 500 },
      answers: { [P1]: { optionIndex: 1, seq: 1 } },
    });
    const commits = (await close({ state }, { questionIndex: 0 })) as AppCommit[];
    const revealed = commits[1];
    expect(revealed.payload.totals).toEqual([{ actorId: P1, total: 1500 }]);
  });

  it('omits correctIndex and awards nothing when the question has no configured correct answer', async () => {
    const settings: QuizSettings = { ...SETTINGS, correctAnswers: [] };
    const state = openState(0, { answers: { [P1]: { optionIndex: 1, seq: 1 } } });
    const commits = (await close({ settings, state }, { questionIndex: 0 })) as AppCommit[];
    const revealed = commits[1];
    expect(revealed.payload).toEqual({ questionIndex: 0, awarded: [], totals: [] });
    expect(revealed.payload).not.toHaveProperty('correctIndex');
  });
});

describe('handleQuizPublish / game.finish', () => {
  const finish = (over: Partial<AppHostContext<QuizState>>) =>
    handleQuizPublish(ctx(over), 'game.finish', {});

  it('rejects non-organizer with PUBLISH_FORBIDDEN', () => {
    expectRejection(() => finish({ actorRole: 'PARTICIPANT' }), 'PUBLISH_FORBIDDEN');
  });

  it('rejects a double finish with ROUND_NOT_OPEN', () => {
    expectRejection(() => finish({ state: { ...initialQuizState(), finished: true } }), 'ROUND_NOT_OPEN');
  });

  it('computes dense-rank standings (1,2,2,3) sorted by total desc', async () => {
    const state: QuizState = {
      ...initialQuizState(),
      totals: { [P1]: 100, [P2]: 50, [P3]: 50, [P4]: 30 },
    };
    const commits = (await finish({ state })) as AppCommit[];
    expect(commits).toEqual([
      { shortName: 'game.finish', payload: {}, visibility: 'public', actor: 'publisher' },
      {
        shortName: 'game.finished',
        payload: {
          standings: [
            { actorId: P1, total: 100, place: 1 },
            { actorId: P2, total: 50, place: 2 },
            { actorId: P3, total: 50, place: 2 },
            { actorId: P4, total: 30, place: 3 },
          ],
        },
        visibility: 'public',
        actor: 'server',
      },
    ]);
  });

  it('finishes with empty standings when nobody scored', async () => {
    const commits = (await finish({})) as AppCommit[];
    expect(commits[1]).toEqual({
      shortName: 'game.finished',
      payload: { standings: [] },
      visibility: 'public',
      actor: 'server',
    });
  });
});

describe('handleQuizPublish / unknown command', () => {
  it('rejects an unknown shortName with EVENT_UNKNOWN_TYPE', () => {
    expectRejection(() => handleQuizPublish(ctx({}), 'no.such.command', {}), 'EVENT_UNKNOWN_TYPE');
  });
});

describe('createQuizRuntime / createQuizApp', () => {
  it('wires appId, manifestVersion, manifest, initialState and reduce', () => {
    const runtime = createQuizRuntime();
    expect(runtime.appId).toBe(QUIZ_APP_ID);
    expect(runtime.manifestVersion).toBe(QUIZ_MANIFEST_VERSION);
    expect(runtime.manifest).toEqual(buildQuizManifest());
    expect(runtime.initialState()).toEqual(initialQuizState());
    const opened = runtime.reduce(runtime.initialState(), {
      shortName: 'question.opened',
      payload: { questionIndex: 0 },
      actorId: ORG,
      seq: 1,
      recordedAt: T0,
    });
    expect(opened.accepting).toBe(true);
    expect(opened.currentQuestion).toBe(0);
  });

  it('dispatches handlePublish through the runtime module', async () => {
    const runtime = createQuizRuntime();
    const commits = await runtime.handlePublish(ctx({}), 'question.opened', { questionIndex: 0 });
    expect(commits).toEqual([
      { shortName: 'question.opened', payload: { questionIndex: 0 }, visibility: 'public', actor: 'publisher' },
    ]);
  });

  it('createQuizApp returns the manifest and the runtime', () => {
    const app = createQuizApp();
    expect(app.manifest).toEqual(buildQuizManifest());
    expect(app.runtime.appId).toBe(QUIZ_APP_ID);
  });
});
