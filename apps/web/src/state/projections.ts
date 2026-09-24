import { coreEventType, type AppLogEvent, type ProjectedEvent, type RoomStatus } from '@mymozhem/sdk';
import { initialQuizState, reduceQuiz, type QuizState } from '@mymozhem/app-quiz';
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
