import type { AppLogEvent } from '@mymozhem/sdk';
import type { z } from 'zod';
import type {
  answerSubmittedPayload,
  questionOpenedPayload,
  questionRevealedPayload,
} from './quiz-events';

// ADR-005: QuizState — проекция из лога событий, чистый редьюсер без побочных
// эффектов и глобального состояния процесса (REQ-CORE-004). Payload'ы здесь не
// валидируются: реестр провалидировал их до коммита в лог; локальные `as`-касты
// лишь сужают Record<string, unknown> к типу соответствующей zod-схемы.

export interface QuizState {
  readonly currentQuestion: number | null;
  readonly accepting: boolean;
  readonly openedAt: string | null; // ISO из recordedAt question.opened — серверное время
  readonly answers: Readonly<Record<string, { optionIndex: number; seq: number }>>; // текущий вопрос, key=actorId
  readonly totals: Readonly<Record<string, number>>;
  readonly finished: boolean;
}

export function initialQuizState(): QuizState {
  return {
    currentQuestion: null,
    accepting: false,
    openedAt: null,
    answers: {},
    totals: {},
    finished: false,
  };
}

export function reduceQuiz(state: QuizState, event: AppLogEvent): QuizState {
  switch (event.shortName) {
    case 'question.opened': {
      const p = event.payload as z.infer<typeof questionOpenedPayload>;
      return {
        ...state,
        currentQuestion: p.questionIndex,
        accepting: true,
        openedAt: event.recordedAt,
        answers: {},
      };
    }
    case 'answer.submitted': {
      // actorId не-null по контракту команды; защитная ветка — no-op, редьюсер не падает.
      if (event.actorId === null) {
        return state;
      }
      const p = event.payload as z.infer<typeof answerSubmittedPayload>;
      return {
        ...state,
        answers: {
          ...state.answers,
          [event.actorId]: { optionIndex: p.optionIndex, seq: event.seq },
        },
      };
    }
    case 'question.closed': {
      return { ...state, accepting: false };
    }
    case 'question.revealed': {
      const p = event.payload as z.infer<typeof questionRevealedPayload>;
      // totals перестраиваются из awarded (derived, не trusted): поле totals
      // payload'а в редьюсере игнорируется.
      const totals: Record<string, number> = { ...state.totals };
      for (const entry of p.awarded) {
        totals[entry.actorId] = (totals[entry.actorId] ?? 0) + entry.points;
      }
      return { ...state, totals };
    }
    case 'game.finished': {
      return { ...state, finished: true };
    }
    default: {
      // game.finish, answer.accepted и неизвестные типы — без изменений состояния.
      return state;
    }
  }
}
