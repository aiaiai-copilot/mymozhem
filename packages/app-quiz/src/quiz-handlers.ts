import { AppRejection, type AppCommit, type AppHostContext } from '@mymozhem/sdk';
import type { z } from 'zod';
import type {
  answerSubmittedPayload,
  questionClosedPayload,
  questionOpenedPayload,
} from './quiz-events';
import { quizSettingsSchema, type QuizSettings } from './quiz-settings';
import type { QuizState } from './quiz-state';

// Командные handlers квиза (дизайн 2026-09-09 §5). Диспетчер ядра уже
// провалидировал payload схемой события — здесь он лишь сужается локальным
// `as`; settings перепарсиваются защитно (проверены при configure, повтор
// дёшев). actorId берётся только из ctx, никогда из payload (REQ-RT-009);
// ролевые гейты — REQ-ID-011; visibility каждого коммита явная и в пределах
// ceiling манифеста (REQ-CTR-009).

type Ctx = AppHostContext<QuizState>;

function requireOrganizer(ctx: Ctx): void {
  if (ctx.actorRole !== 'ORGANIZER') {
    throw new AppRejection('PUBLISH_FORBIDDEN', 'команда доступна только организатору');
  }
}

function openQuestion(ctx: Ctx, settings: QuizSettings, payload: Record<string, unknown>): AppCommit[] {
  requireOrganizer(ctx);
  if (ctx.state.finished) {
    throw new AppRejection('ROUND_NOT_OPEN', 'игра завершена');
  }
  if (ctx.state.accepting) {
    throw new AppRejection('ROUND_NOT_OPEN', 'прежний вопрос не закрыт');
  }
  const p = payload as z.infer<typeof questionOpenedPayload>;
  if (p.questionIndex >= settings.questions.length) {
    throw new AppRejection('QUESTION_UNKNOWN', `вопроса с индексом ${p.questionIndex} нет в настройках`);
  }
  return [{ shortName: 'question.opened', payload, visibility: 'public', actor: 'publisher' }];
}

function submitAnswer(ctx: Ctx, settings: QuizSettings, payload: Record<string, unknown>): AppCommit[] {
  // Организатор не играет; SPECTATOR отсекается ядром раньше — ветка защитная.
  if (ctx.actorRole !== 'PARTICIPANT') {
    throw new AppRejection('PUBLISH_FORBIDDEN', 'отвечать могут только участники');
  }
  const { state } = ctx;
  if (!state.accepting || state.currentQuestion === null) {
    throw new AppRejection('ROUND_NOT_OPEN', 'сейчас нет открытого вопроса');
  }
  const p = payload as z.infer<typeof answerSubmittedPayload>;
  if (p.questionIndex !== state.currentQuestion) {
    throw new AppRejection('QUESTION_UNKNOWN', 'ответ относится не к открытому вопросу');
  }
  const question = settings.questions[state.currentQuestion];
  if (question === undefined || p.optionIndex >= question.options.length) {
    throw new AppRejection('OPTION_UNKNOWN', `варианта с индексом ${p.optionIndex} нет в вопросе`);
  }
  if (state.answers[ctx.actorId] !== undefined) {
    throw new AppRejection('ALREADY_ANSWERED', 'ответ на этот вопрос уже принят');
  }
  // REQ-RT-013: анти-бот — минимальный интервал между открытием вопроса и ответом.
  if (
    settings.minAnswerIntervalMs > 0 &&
    state.openedAt !== null &&
    Date.parse(ctx.now) - Date.parse(state.openedAt) < settings.minAnswerIntervalMs
  ) {
    throw new AppRejection('ANSWER_TOO_FAST', 'ответ отправлен раньше минимального интервала');
  }
  return [
    { shortName: 'answer.submitted', payload, visibility: 'module-private', actor: 'publisher' },
    {
      shortName: 'answer.accepted',
      payload: { questionIndex: p.questionIndex, actorId: ctx.actorId },
      visibility: 'public',
      actor: 'server',
    },
  ];
}

// Детерминированный порядок табло: по убыванию total, при равенстве — по actorId.
function byTotalDescThenActor(a: { actorId: string; total: number }, b: { actorId: string; total: number }): number {
  return b.total - a.total || (a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0);
}

function closeQuestion(ctx: Ctx, settings: QuizSettings, payload: Record<string, unknown>): AppCommit[] {
  requireOrganizer(ctx);
  const { state } = ctx;
  const p = payload as z.infer<typeof questionClosedPayload>;
  if (!state.accepting || p.questionIndex !== state.currentQuestion) {
    throw new AppRejection('ROUND_NOT_OPEN', 'этот вопрос сейчас не открыт');
  }
  const questionIndex = p.questionIndex;
  const correctIndex = settings.correctAnswers[questionIndex];
  // Скоростная шкала: правильные ответы ранжируются по seq, k-й (0-based)
  // получает max(base - k*step, 0). Без сконфигурированного correctAnswers[qi]
  // правильных нет, поле correctIndex в reveal опускается (схема — optional).
  const correct = Object.entries(state.answers)
    .filter(([, answer]) => correctIndex !== undefined && answer.optionIndex === correctIndex)
    .sort(([, a], [, b]) => a.seq - b.seq);
  const awarded = correct.map(([actorId], k) => ({
    actorId,
    points: Math.max(settings.scoring.base - k * settings.scoring.step, 0),
  }));
  const totalsMap: Record<string, number> = { ...state.totals };
  for (const entry of awarded) {
    totalsMap[entry.actorId] = (totalsMap[entry.actorId] ?? 0) + entry.points;
  }
  const totals = Object.entries(totalsMap)
    .map(([actorId, total]) => ({ actorId, total }))
    .sort(byTotalDescThenActor);
  return [
    { shortName: 'question.closed', payload, visibility: 'public', actor: 'publisher' },
    {
      shortName: 'question.revealed',
      payload: {
        questionIndex,
        awarded,
        totals,
        ...(correctIndex !== undefined ? { correctIndex } : {}),
      },
      visibility: 'public',
      actor: 'server',
    },
  ];
}

function finishGame(ctx: Ctx, payload: Record<string, unknown>): AppCommit[] {
  requireOrganizer(ctx);
  if (ctx.state.finished) {
    throw new AppRejection('ROUND_NOT_OPEN', 'игра уже завершена');
  }
  // Плотный ранг (1,2,2,3): равные total делят место, следующее отличное
  // значение получает непосредственно следующее место (не index + 1 — это был
  // бы competition ranking 1,2,2,4).
  const sorted = Object.entries(ctx.state.totals)
    .map(([actorId, total]) => ({ actorId, total }))
    .sort(byTotalDescThenActor);
  let place = 0;
  let previousTotal: number | undefined;
  const standings = sorted.map((entry) => {
    if (previousTotal === undefined || entry.total !== previousTotal) {
      place += 1;
      previousTotal = entry.total;
    }
    return { ...entry, place };
  });
  return [
    { shortName: 'game.finish', payload, visibility: 'public', actor: 'publisher' },
    { shortName: 'game.finished', payload: { standings }, visibility: 'public', actor: 'server' },
  ];
}

export function handleQuizPublish(
  ctx: AppHostContext<QuizState>,
  shortName: string,
  payload: Record<string, unknown>,
): AppCommit[] {
  const settings = quizSettingsSchema.parse(ctx.settings);
  switch (shortName) {
    case 'question.opened':
      return openQuestion(ctx, settings, payload);
    case 'answer.submitted':
      return submitAnswer(ctx, settings, payload);
    case 'question.closed':
      return closeQuestion(ctx, settings, payload);
    case 'game.finish':
      return finishGame(ctx, payload);
    default:
      // Недостижимо при корректном диспетчере (только clientInitiated из
      // манифеста) — защитная ветка.
      throw new AppRejection('EVENT_UNKNOWN_TYPE', `неизвестная команда: ${shortName}`);
  }
}
