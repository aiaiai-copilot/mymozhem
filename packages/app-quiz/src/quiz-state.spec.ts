import type { AppLogEvent } from '@mymozhem/sdk';
import { initialQuizState, reduceQuiz, type QuizState } from './quiz-state';

// ADR-005: QuizState — чистая проекция из лога событий; редьюсер не доверяет
// payload'ам (реестр уже провалидировал их до коммита в лог) и перестраивает
// производные значения (totals) из первичных данных (awarded).
const ACTOR = '0f8fad5b-d9cb-469f-a165-70867728950e';
const ACTOR_2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function event(shortName: string, payload: Record<string, unknown>, overrides: Partial<AppLogEvent> = {}): AppLogEvent {
  return {
    shortName,
    payload,
    actorId: ACTOR,
    seq: 1,
    recordedAt: '2026-09-09T12:00:00.000Z',
    ...overrides,
  };
}

describe('initialQuizState', () => {
  it('starts with no open question, no answers, no totals, not finished', () => {
    expect(initialQuizState()).toEqual({
      currentQuestion: null,
      accepting: false,
      openedAt: null,
      answers: {},
      totals: {},
      finished: false,
    });
  });
});

describe('reduceQuiz', () => {
  it('question.opened opens the question and stamps openedAt from event.recordedAt', () => {
    const next = reduceQuiz(initialQuizState(), event('question.opened', { questionIndex: 2 }, { recordedAt: '2026-09-09T12:34:56.000Z' }));

    expect(next.currentQuestion).toBe(2);
    expect(next.accepting).toBe(true);
    expect(next.openedAt).toBe('2026-09-09T12:34:56.000Z');
    expect(next.answers).toEqual({});
  });

  it('answer.submitted records answers of two players with their seq', () => {
    const opened = reduceQuiz(initialQuizState(), event('question.opened', { questionIndex: 0 }));
    const withFirst = reduceQuiz(opened, event('answer.submitted', { questionIndex: 0, optionIndex: 1 }, { actorId: ACTOR, seq: 5 }));
    const withBoth = reduceQuiz(withFirst, event('answer.submitted', { questionIndex: 0, optionIndex: 0 }, { actorId: ACTOR_2, seq: 7 }));

    expect(withBoth.answers).toEqual({
      [ACTOR]: { optionIndex: 1, seq: 5 },
      [ACTOR_2]: { optionIndex: 0, seq: 7 },
    });
    expect(withBoth.currentQuestion).toBe(0);
    expect(withBoth.accepting).toBe(true);
  });

  it('re-opening another question resets answers and re-stamps openedAt', () => {
    const opened = reduceQuiz(initialQuizState(), event('question.opened', { questionIndex: 0 }, { recordedAt: '2026-09-09T12:00:00.000Z' }));
    const withAnswer = reduceQuiz(opened, event('answer.submitted', { questionIndex: 0, optionIndex: 1 }, { actorId: ACTOR, seq: 2 }));
    const reopened = reduceQuiz(withAnswer, event('question.opened', { questionIndex: 1 }, { recordedAt: '2026-09-09T12:05:00.000Z' }));

    expect(reopened.currentQuestion).toBe(1);
    expect(reopened.answers).toEqual({});
    expect(reopened.openedAt).toBe('2026-09-09T12:05:00.000Z');
    expect(reopened.accepting).toBe(true);
  });

  it('question.closed stops accepting without touching answers', () => {
    const opened = reduceQuiz(initialQuizState(), event('question.opened', { questionIndex: 0 }));
    const withAnswer = reduceQuiz(opened, event('answer.submitted', { questionIndex: 0, optionIndex: 1 }, { actorId: ACTOR, seq: 3 }));
    const closed = reduceQuiz(withAnswer, event('question.closed', { questionIndex: 0 }));

    expect(closed.accepting).toBe(false);
    expect(closed.answers).toEqual(withAnswer.answers);
  });

  it('question.revealed accumulates totals from awarded across two rounds, ignoring the payload totals field', () => {
    let state = initialQuizState();
    // Раунд 1: оба игрока получили очки. totals в payload намеренно «врёт» —
    // проекция обязана перестроить сумму из awarded (ADR-005: derived, не trusted).
    state = reduceQuiz(state, event('question.revealed', {
      questionIndex: 0,
      correctIndex: 1,
      awarded: [
        { actorId: ACTOR, points: 110 },
        { actorId: ACTOR_2, points: 90 },
      ],
      totals: [{ actorId: ACTOR, total: 9999 }],
    }));
    expect(state.totals).toEqual({ [ACTOR]: 110, [ACTOR_2]: 90 });

    // Раунд 2: очки суммируются с предыдущими.
    state = reduceQuiz(state, event('question.revealed', {
      questionIndex: 1,
      awarded: [
        { actorId: ACTOR, points: 100 },
        { actorId: ACTOR_2, points: 50 },
      ],
      totals: [],
    }));
    expect(state.totals).toEqual({ [ACTOR]: 210, [ACTOR_2]: 140 });
  });

  it('game.finished marks the game finished', () => {
    const finished = reduceQuiz(initialQuizState(), event('game.finished', {
      standings: [
        { actorId: ACTOR, total: 210, place: 1 },
        { actorId: ACTOR_2, total: 140, place: 2 },
      ],
    }));

    expect(finished.finished).toBe(true);
  });

  it.each(['game.finish', 'answer.accepted'])('%s leaves the state unchanged', (shortName) => {
    const state = reduceQuiz(initialQuizState(), event('question.opened', { questionIndex: 0 }));
    const next = reduceQuiz(state, event(shortName, shortName === 'answer.accepted' ? { questionIndex: 0, actorId: ACTOR } : {}));

    expect(next).toBe(state);
  });

  it('ignores an unknown event type (registry guarantees types, but the reducer must not crash)', () => {
    const state = reduceQuiz(initialQuizState(), event('question.opened', { questionIndex: 0 }));
    const next = reduceQuiz(state, event('some.unknown', { anything: true }));

    expect(next).toBe(state);
  });

  it('does not mutate the input state (immutable updates)', () => {
    const state = reduceQuiz(initialQuizState(), event('question.opened', { questionIndex: 0 }));
    const snapshot: QuizState = JSON.parse(JSON.stringify(state)) as QuizState;

    const next = reduceQuiz(state, event('answer.submitted', { questionIndex: 0, optionIndex: 2 }, { actorId: ACTOR, seq: 4 }));

    expect(next).not.toBe(state);
    expect(state).toEqual(snapshot);
    expect(next.answers).not.toBe(state.answers);

    const revealed = reduceQuiz(state, event('question.revealed', {
      questionIndex: 0,
      awarded: [{ actorId: ACTOR, points: 10 }],
      totals: [],
    }));
    expect(revealed).not.toBe(state);
    expect(revealed.totals).not.toBe(state.totals);
    expect(state).toEqual(snapshot);
  });
});
