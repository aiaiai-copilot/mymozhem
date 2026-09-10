import { defineApp, type AppManifest } from '@mymozhem/sdk';
import { quizSettingsSchema } from './quiz-settings';
import {
  answerAcceptedPayload,
  answerSubmittedPayload,
  finishGamePayload,
  gameFinishedPayload,
  questionClosedPayload,
  questionOpenedPayload,
  questionRevealedPayload,
} from './quiz-events';

export const QUIZ_APP_ID = 'quiz';
export const QUIZ_MANIFEST_VERSION = 1;
export function buildQuizManifest(): AppManifest {
  return defineApp({
    appId: QUIZ_APP_ID,
    manifestVersion: QUIZ_MANIFEST_VERSION,
    appSettings: quizSettingsSchema,
    events: {
      'question.opened': { schema: questionOpenedPayload, visibility: 'public', clientInitiated: true },
      'answer.submitted': { schema: answerSubmittedPayload, visibility: 'module-private', clientInitiated: true },
      'question.closed': { schema: questionClosedPayload, visibility: 'public', clientInitiated: true },
      'game.finish': { schema: finishGamePayload, visibility: 'public', clientInitiated: true },
      'answer.accepted': { schema: answerAcceptedPayload, visibility: 'public', clientInitiated: false },
      'question.revealed': { schema: questionRevealedPayload, visibility: 'public', clientInitiated: false },
      'game.finished': { schema: gameFinishedPayload, visibility: 'public', clientInitiated: false },
    },
  });
}
