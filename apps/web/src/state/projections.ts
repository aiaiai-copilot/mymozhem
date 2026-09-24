import { coreEventType, type AppLogEvent, type ProjectedEvent, type RoomStatus } from '@mymozhem/sdk';
import {
  answerAcceptedPayload,
  initialQuizState,
  reduceQuiz,
  type QuizState,
} from '@mymozhem/app-quiz';
import { initialLotteryState, reduceLottery, type LotteryState } from '@mymozhem/app-lottery';

// Адаптер wire → AppLogEvent (дизайн §3): wire несёт '<appId>.<short>' без seq/recordedAt
// (REQ-RT-011a). Локальный seq сохраняет порядок приёма; recordedAt — момент приёма
// (только отображение; баллы едут в payload question.revealed, не из тайминга).
export const toAppLogEvent = (
  event: ProjectedEvent,
  appId: string,
  localSeq: number,
  recordedAt: string,
): AppLogEvent => ({
  shortName: event.type.slice(appId.length + 1),
  payload: event.payload,
  actorId: event.actorId,
  seq: localSeq,
  recordedAt,
});

const foldApp = <S>(
  appId: string,
  events: ProjectedEvent[],
  initial: () => S,
  reduce: (state: S, event: AppLogEvent) => S,
  recordedAt: string,
): S =>
  events
    .filter((e) => e.type.startsWith(`${appId}.`))
    .reduce((state, e, i) => reduce(state, toAppLogEvent(e, appId, i + 1, recordedAt)), initial());

export const projectQuiz = (events: ProjectedEvent[], recordedAt: string): QuizState =>
  foldApp('quiz', events, initialQuizState, reduceQuiz, recordedAt);
export const projectLottery = (events: ProjectedEvent[], recordedAt: string): LotteryState =>
  foldApp('lottery', events, initialLotteryState, reduceLottery, recordedAt);

// Ответившие на вопрос — из публичных quiz.answer.accepted (payload
// {questionIndex, actorId}). answer.submitted коммитится с visibility
// module-private (решение ф.2) и до участников не доезжает, поэтому
// quiz.answers на клиенте всегда пуст: verdict reveal и «ответ уже отправлен»
// строятся только по публичным сигналам провода. Shared reduceQuiz осознанно
// игнорирует accept (в payload нет optionIndex — редьюсеру он не нужен),
// поэтому это отдельная клиентская проекция, а не изменение редьюсера.
// Отдельного состояния у проекции нет — она выводится из лога и переживает
// перефолд/reload (accept едет в snapshot).
export const projectAnsweredActors = (
  events: ProjectedEvent[],
  questionIndex: number,
): ReadonlySet<string> => {
  const answered = new Set<string>();
  for (const e of events) {
    if (e.type !== 'quiz.answer.accepted') continue;
    const p = answerAcceptedPayload.parse(e.payload);
    if (p.questionIndex === questionIndex) answered.add(p.actorId);
  }
  return answered;
};

// Статус комнаты — из lifecycle-событий лога (REQ-RT-010); последнее побеждает.
export const deriveRoomStatus = (events: ProjectedEvent[]): RoomStatus => {
  let status: RoomStatus = 'DRAFT';
  for (const e of events) {
    if (e.type === coreEventType('room.activated')) status = 'ACTIVE';
    else if (e.type === coreEventType('room.completed')) status = 'COMPLETED';
    else if (e.type === coreEventType('room.cancelled')) status = 'CANCELLED';
  }
  return status;
};
