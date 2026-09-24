import { describe, expect, it } from 'vitest';
import type { ProjectedEvent } from '@mymozhem/sdk';
import { initialQuizState } from '@mymozhem/app-quiz';
import { answersCount, nextQuestionIndex } from './quiz-controls';

const HOST = '11111111-1111-4111-8111-111111111111';
const PLAYER_1 = '0f8fad5b-d9cb-469f-a165-70867728950e';
const PLAYER_2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

// Счётчик ответов консоли строится ТОЛЬКО по публичным quiz.answer.accepted:
// answer.submitted — module-private (манифест app-quiz) и до клиента не доезжает,
// поэтому любая логика на нём была бы мёртвой.
describe('answersCount', () => {
  it('считает distinct actorId среди quiz.answer.accepted текущего вопроса', () => {
    const events: ProjectedEvent[] = [
      { type: 'quiz.question.opened', payload: { questionIndex: 0 }, actorId: HOST },
      { type: 'quiz.answer.accepted', payload: { questionIndex: 0, actorId: PLAYER_1 }, actorId: null },
      { type: 'quiz.answer.accepted', payload: { questionIndex: 0, actorId: PLAYER_2 }, actorId: null },
    ];
    expect(answersCount(events, 0)).toBe(2);
  });

  it('повторный accept того же актора не удваивает счётчик', () => {
    const events: ProjectedEvent[] = [
      { type: 'quiz.answer.accepted', payload: { questionIndex: 0, actorId: PLAYER_1 }, actorId: null },
      { type: 'quiz.answer.accepted', payload: { questionIndex: 0, actorId: PLAYER_1 }, actorId: null },
    ];
    expect(answersCount(events, 0)).toBe(1);
  });

  it('игнорирует accept других вопросов', () => {
    const events: ProjectedEvent[] = [
      { type: 'quiz.answer.accepted', payload: { questionIndex: 0, actorId: PLAYER_1 }, actorId: null },
      { type: 'quiz.answer.accepted', payload: { questionIndex: 1, actorId: PLAYER_2 }, actorId: null },
    ];
    expect(answersCount(events, 1)).toBe(1);
    expect(answersCount(events, 0)).toBe(1);
  });

  it('quiz.answer.submitted (module-private) не участвует в счётчике', () => {
    const events: ProjectedEvent[] = [
      { type: 'quiz.answer.submitted', payload: { questionIndex: 0, optionIndex: 1 }, actorId: PLAYER_1 },
      { type: 'quiz.answer.accepted', payload: { questionIndex: 0, actorId: PLAYER_2 }, actorId: null },
    ];
    expect(answersCount(events, 0)).toBe(1);
  });

  it('нет accepted — 0', () => {
    expect(answersCount([], 0)).toBe(0);
  });
});

// N следующего вопроса: до первого open — 0, дальше currentQuestion + 1
// (бриф Task 14; это же payload questionIndex команды quiz.question.opened).
describe('nextQuestionIndex', () => {
  it('вопрос ещё не открывался (currentQuestion === null) → 0', () => {
    expect(nextQuestionIndex(initialQuizState())).toBe(0);
  });

  it('текущий вопрос 0 → следующий 1', () => {
    expect(nextQuestionIndex({ ...initialQuizState(), currentQuestion: 0 })).toBe(1);
  });

  it('текущий вопрос 3 → следующий 4', () => {
    expect(nextQuestionIndex({ ...initialQuizState(), currentQuestion: 3 })).toBe(4);
  });
});
