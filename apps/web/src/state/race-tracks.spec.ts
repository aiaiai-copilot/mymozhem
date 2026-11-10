import { describe, expect, it } from 'vitest';
import type { ProjectedEvent } from '@mymozhem/sdk';
import {
  lastRoundGains,
  myPlace,
  topNWithRest,
  trackWidths,
} from './race-tracks';
import { PLAYER_1, PLAYER_2, quizMiniGameLog } from './fixtures/quiz-log.fixture';

// Логика дорожек «забега» (дизайн §7): нормировка к лидеру (=100%), прирост
// за раунд — awarded ПОСЛЕДНЕГО quiz.question.revealed из перефолженного лога
// (reconnect-safe), fill отделён от gain: fill = (total−gain)/leader,
// gain = gain/leader. Все проценты — числа 0..100.

describe('trackWidths', () => {
  const entries = [
    { actorId: 'a', total: 1500 },
    { actorId: 'b', total: 1200 },
    { actorId: 'c', total: 900 },
  ];

  it('нормировка к лидеру: 1500/1200/900 → 100/80/60', () => {
    const w = trackWidths(entries, {});
    expect(w.get('a')).toEqual({ fillPct: 100, gainPct: 0 });
    expect(w.get('b')).toEqual({ fillPct: 80, gainPct: 0 });
    expect(w.get('c')).toEqual({ fillPct: 60, gainPct: 0 });
  });

  it('прирост-сегмент отделён от fill: fill = (total−gain)/leader, gain = gain/leader', () => {
    const w = trackWidths(entries, { a: 300 });
    // Лидер: fill = (1500−300)/1500 = 80, gain = 300/1500 = 20; сумма снова 100.
    expect(w.get('a')).toEqual({ fillPct: 80, gainPct: 20 });
  });

  it('нулевой gain → gainPct 0, fill не урезан', () => {
    const w = trackWidths(entries, { b: 0 });
    expect(w.get('b')).toEqual({ fillPct: 80, gainPct: 0 });
  });

  it('лидер 0 (все нули) → все дорожки пустые (0/0), без деления на ноль', () => {
    const w = trackWidths(
      [
        { actorId: 'a', total: 0 },
        { actorId: 'b', total: 0 },
      ],
      {},
    );
    expect(w.get('a')).toEqual({ fillPct: 0, gainPct: 0 });
    expect(w.get('b')).toEqual({ fillPct: 0, gainPct: 0 });
  });

  it('gain не из entries (нет записи в gains) → gainPct 0', () => {
    const w = trackWidths([{ actorId: 'a', total: 500 }], {});
    expect(w.get('a')).toEqual({ fillPct: 100, gainPct: 0 });
  });
});

describe('lastRoundGains', () => {
  it('golden-фикстура: берётся awarded ПОСЛЕДНЕГО reveal (вопрос 1, не вопрос 0)', () => {
    // В фикстуре два reveal: вопрос 0 наградил PLAYER_1 (110), вопрос 1 — PLAYER_2 (100).
    expect(lastRoundGains(quizMiniGameLog)).toEqual({ [PLAYER_2]: 100 });
  });

  it('два reveal подряд → побеждает второй', () => {
    const events: ProjectedEvent[] = [
      {
        type: 'quiz.question.revealed',
        payload: {
          questionIndex: 0,
          correctIndex: 1,
          awarded: [{ actorId: PLAYER_1, points: 110 }],
          totals: [{ actorId: PLAYER_1, total: 110 }],
        },
        actorId: null,
      },
      {
        type: 'quiz.question.revealed',
        payload: {
          questionIndex: 1,
          awarded: [
            { actorId: PLAYER_1, points: 40 },
            { actorId: PLAYER_2, points: 90 },
          ],
          totals: [
            { actorId: PLAYER_1, total: 150 },
            { actorId: PLAYER_2, total: 90 },
          ],
        },
        actorId: null,
      },
    ];
    expect(lastRoundGains(events)).toEqual({ [PLAYER_1]: 40, [PLAYER_2]: 90 });
  });

  it('reveal не было → пустая запись', () => {
    const events: ProjectedEvent[] = [
      {
        type: 'quiz.question.opened',
        payload: { questionIndex: 0, openedAt: '2026-10-20T12:00:00.000Z' },
        actorId: PLAYER_1,
      },
    ];
    expect(lastRoundGains(events)).toEqual({});
    expect(lastRoundGains([])).toEqual({});
  });
});

describe('topNWithRest', () => {
  it('7 элементов, n=4 → top 4, rest 3', () => {
    const { top, rest } = topNWithRest([1, 2, 3, 4, 5, 6, 7], 4);
    expect(top).toEqual([1, 2, 3, 4]);
    expect(rest).toBe(3);
  });

  it('n >= длины → rest 0, top — весь список', () => {
    expect(topNWithRest([1, 2], 5)).toEqual({ top: [1, 2], rest: 0 });
  });

  it('пустой список → top [], rest 0', () => {
    expect(topNWithRest([], 4)).toEqual({ top: [], rest: 0 });
  });
});

describe('myPlace', () => {
  // Уже отсортировано desc; равные очки делят место (плотный порядок).
  const sorted = [
    { actorId: 'a', total: 1500 },
    { actorId: 'b', total: 1200 },
    { actorId: 'c', total: 1200 },
    { actorId: 'd', total: 900 },
  ];

  it('плотный порядок desc: равные делят место, следующее — +1', () => {
    expect(myPlace(sorted, 'a')).toBe(1);
    expect(myPlace(sorted, 'b')).toBe(2);
    expect(myPlace(sorted, 'c')).toBe(2);
    expect(myPlace(sorted, 'd')).toBe(3);
  });

  it('отсутствующий id → null', () => {
    expect(myPlace(sorted, 'zzz')).toBeNull();
  });
});
