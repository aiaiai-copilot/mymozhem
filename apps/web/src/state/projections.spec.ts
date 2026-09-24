import { describe, expect, it } from 'vitest';
import { coreEventType, type ProjectedEvent } from '@mymozhem/sdk';
import {
  deriveRoomStatus,
  projectAnsweredActors,
  projectLottery,
  projectQuiz,
  toAppLogEvent,
} from './projections';
import { PLAYER_1, PLAYER_2, quizMiniGameLog } from './fixtures/quiz-log.fixture';

// recordedAt — момент приёма на клиенте, только отображение (дизайн §3): баллы
// едут в payload question.revealed, не из тайминга. Фиксированной строкой, чтобы
// golden-ассерт был детерминированным.
const RECORDED_AT = '2026-09-23T12:00:00.000Z';

// Лотерейное событие для фильтра/проекции lottery: форма по drawCompletedPayload.
const DRAW = {
  drawId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  prizeId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  winnerId: PLAYER_1,
};
const lotteryEvent: ProjectedEvent = {
  type: 'lottery.draw.completed',
  payload: DRAW,
  actorId: null,
};

describe('projectQuiz — golden', () => {
  it('фолд записанного лога ≡ ожидаемая проекция (порядок/адаптер, не редьюсер)', () => {
    const state = projectQuiz(quizMiniGameLog, RECORDED_AT);

    expect(state.currentQuestion).toBe(1);
    expect(state.accepting).toBe(false);
    expect(state.totals).toEqual({ [PLAYER_1]: 110, [PLAYER_2]: 100 });
    expect(state.finished).toBe(true);
    // recordedAt проекции — ровно переданная строка (openedAt текущего вопроса).
    expect(state.openedAt).toBe(RECORDED_AT);
    // Локальный seq нумерует quiz-события в порядке приёма (core отфильтрован):
    // ответы второго вопроса — 7-е и 8-е quiz-события лога.
    expect(state.answers).toEqual({
      [PLAYER_1]: { optionIndex: 0, seq: 7 },
      [PLAYER_2]: { optionIndex: 2, seq: 8 },
    });
  });

  it('фильтр по appId: события lottery/core не попадают в quiz-проекцию', () => {
    const mixed = [...quizMiniGameLog, lotteryEvent];
    // core.room.activated уже в фикстуре; lottery добавлено — проекция квиза
    // обязана совпасть с фолдом только quiz-событий.
    const quizOnly = quizMiniGameLog.filter((e) => e.type.startsWith('quiz.'));

    expect(projectQuiz(mixed, RECORDED_AT)).toEqual(projectQuiz(quizOnly, RECORDED_AT));
  });
});

describe('projectLottery', () => {
  it('фолдит только lottery-события: draw.completed попадает в draws, quiz/core — нет', () => {
    expect(projectLottery(quizMiniGameLog, RECORDED_AT)).toEqual({ draws: {} });

    const state = projectLottery([...quizMiniGameLog, lotteryEvent], RECORDED_AT);
    expect(state.draws).toEqual({
      [DRAW.drawId]: { prizeId: DRAW.prizeId, winnerId: DRAW.winnerId },
    });
  });
});

describe('toAppLogEvent', () => {
  it('режет префикс appId из типа и проставляет локальные seq/recordedAt', () => {
    const wire: ProjectedEvent = {
      type: 'quiz.answer.submitted',
      payload: { questionIndex: 0, optionIndex: 1 },
      actorId: PLAYER_1,
    };

    expect(toAppLogEvent(wire, 'quiz', 42, RECORDED_AT)).toEqual({
      shortName: 'answer.submitted',
      payload: wire.payload,
      actorId: PLAYER_1,
      seq: 42,
      recordedAt: RECORDED_AT,
    });
  });
});

describe('projectAnsweredActors', () => {
  const accept = (questionIndex: number, actorId: string): ProjectedEvent => ({
    type: 'quiz.answer.accepted',
    payload: { questionIndex, actorId },
    actorId: null,
  });

  it('фолдит публичные quiz.answer.accepted вопроса в множество ответивших', () => {
    const events = [accept(0, PLAYER_1), accept(0, PLAYER_2)];

    const answered = projectAnsweredActors(events, 0);
    expect(answered.has(PLAYER_1)).toBe(true);
    expect(answered.has(PLAYER_2)).toBe(true);
    expect(answered.size).toBe(2);
  });

  it('игнорирует accept других вопросов, не-accept события и чужие префиксы appId', () => {
    const events: ProjectedEvent[] = [
      accept(1, PLAYER_1),
      { type: 'quiz.question.opened', payload: { questionIndex: 0 }, actorId: null },
      // answer.submitted — module-private, до участника не доезжает; даже если бы
      // доехал, verdict обязан строиться только по публичному accept.
      { type: 'quiz.answer.submitted', payload: { questionIndex: 0, optionIndex: 1 }, actorId: PLAYER_2 },
      { type: 'lottery.answer.accepted', payload: { questionIndex: 0, actorId: PLAYER_2 }, actorId: null },
    ];

    expect(projectAnsweredActors(events, 0).size).toBe(0);
    const first = projectAnsweredActors(events, 1);
    expect(first.has(PLAYER_1)).toBe(true);
    expect(first.size).toBe(1);
  });

  it('переживает перефолд: accept из snapshot попадает в проекцию (reload не теряет факт ответа)', () => {
    // После reload events строятся заново из snapshot — answered-set выводится
    // из того же лога, отдельного локального состояния у проекции нет.
    const snapshotEvents = [accept(0, PLAYER_1)];
    expect(projectAnsweredActors(snapshotEvents, 0).has(PLAYER_1)).toBe(true);
  });
});

describe('deriveRoomStatus', () => {  const ev = (type: string): ProjectedEvent => ({ type, payload: {}, actorId: null });

  it('пусто → DRAFT; activated → ACTIVE; completed позже → COMPLETED', () => {
    expect(deriveRoomStatus([])).toBe('DRAFT');
    expect(deriveRoomStatus([ev(coreEventType('room.activated'))])).toBe('ACTIVE');
    // Последнее lifecycle-событие побеждает (REQ-RT-010).
    expect(
      deriveRoomStatus([ev(coreEventType('room.activated')), ev(coreEventType('room.completed'))]),
    ).toBe('COMPLETED');
  });

  it('cancelled после activated → CANCELLED; не-lifecycle события статус не меняют', () => {
    expect(
      deriveRoomStatus([ev(coreEventType('room.activated')), ev(coreEventType('room.cancelled'))]),
    ).toBe('CANCELLED');
    expect(deriveRoomStatus([ev('quiz.question.opened')])).toBe('DRAFT');
  });
});
