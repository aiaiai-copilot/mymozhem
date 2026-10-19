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
// v3: durationSec вопроса + серверный openedAt в question.opened (дизайн/UI-срез,
// Task 3). Совместимости с v2 нет: реестр знает только v3, комнаты quiz@2 после
// редеплоя получают APP_MANIFEST_UNKNOWN (принято дизайном §13, прецедент lottery@1).
export const QUIZ_MANIFEST_VERSION = 3;
export function buildQuizManifest(): AppManifest {
  return defineApp({
    appId: QUIZ_APP_ID,
    manifestVersion: QUIZ_MANIFEST_VERSION,
    capabilities: ['rewards'], // фаза 3: начисления баллов эффектами (design 2026-09-10 §5)
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
