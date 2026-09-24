import type { ProjectedEvent } from '@mymozhem/sdk';

// Golden-фикстура (дизайн §3): рукописный лог мини-игры в квиз — 2 вопроса,
// 2 игрока (open → submit ×2 → close → reveal) ×2 → finish. Wire-форма
// (ProjectedEvent): полные типы `<appId>.<short>`, без seq/recordedAt
// (REQ-RT-011a). Формы payload'ов — по zod-схемам app-quiz (quiz-events.ts).
// Пинит фолд: порядок приёма, адаптер wire → AppLogEvent, фильтр по appId —
// а не редьюсер (он запинан спеками пакета app-quiz).
export const HOST = '11111111-1111-4111-8111-111111111111';
export const PLAYER_1 = '0f8fad5b-d9cb-469f-a165-70867728950e';
export const PLAYER_2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

export const quizMiniGameLog: ProjectedEvent[] = [
  {
    type: 'core.room.activated',
    payload: { appId: 'quiz', manifestVersion: 2 },
    actorId: null,
  },
  // Вопрос 0: PLAYER_1 отвечает верно (1), PLAYER_2 — неверно (0).
  {
    type: 'quiz.question.opened',
    payload: { questionIndex: 0 },
    actorId: HOST,
  },
  {
    type: 'quiz.answer.submitted',
    payload: { questionIndex: 0, optionIndex: 1 },
    actorId: PLAYER_1,
  },
  {
    type: 'quiz.answer.submitted',
    payload: { questionIndex: 0, optionIndex: 0 },
    actorId: PLAYER_2,
  },
  {
    type: 'quiz.question.closed',
    payload: { questionIndex: 0 },
    actorId: HOST,
  },
  {
    type: 'quiz.question.revealed',
    payload: {
      questionIndex: 0,
      correctIndex: 1,
      awarded: [{ actorId: PLAYER_1, points: 110 }],
      totals: [
        { actorId: PLAYER_1, total: 110 },
        { actorId: PLAYER_2, total: 0 },
      ],
    },
    actorId: null,
  },
  // Вопрос 1: верно отвечает PLAYER_2 (2); PLAYER_1 мимо (0).
  {
    type: 'quiz.question.opened',
    payload: { questionIndex: 1 },
    actorId: HOST,
  },
  {
    type: 'quiz.answer.submitted',
    payload: { questionIndex: 1, optionIndex: 0 },
    actorId: PLAYER_1,
  },
  {
    type: 'quiz.answer.submitted',
    payload: { questionIndex: 1, optionIndex: 2 },
    actorId: PLAYER_2,
  },
  {
    type: 'quiz.question.closed',
    payload: { questionIndex: 1 },
    actorId: HOST,
  },
  {
    type: 'quiz.question.revealed',
    payload: {
      questionIndex: 1,
      correctIndex: 2,
      awarded: [{ actorId: PLAYER_2, points: 100 }],
      totals: [
        { actorId: PLAYER_1, total: 110 },
        { actorId: PLAYER_2, total: 100 },
      ],
    },
    actorId: null,
  },
  {
    type: 'quiz.game.finished',
    payload: {
      standings: [
        { actorId: PLAYER_1, total: 110, place: 1 },
        { actorId: PLAYER_2, total: 100, place: 2 },
      ],
    },
    actorId: null,
  },
];
