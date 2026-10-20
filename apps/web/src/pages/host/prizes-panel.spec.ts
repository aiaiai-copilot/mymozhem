import { describe, expect, it } from 'vitest';
import type { PrizeResponse, ProjectedEvent } from '@mymozhem/sdk';
import {
  DRAW_ID_GENERATION_FAILED,
  drawPrizeName,
  isDrawable,
  lastCompletedDraw,
  startDrawAttempt,
  startParticipantDrawAttempt,
  tryStartDrawAttempt,
  tryStartParticipantDrawAttempt,
  type CompletedDraw,
  type DrawAttempt,
} from './prizes-panel';

const ROOM = '11111111-1111-4111-8111-111111111111';

const prize = (quantity: number): PrizeResponse => ({
  id: '22222222-2222-4222-8222-222222222222',
  roomId: ROOM,
  name: 'Кубок',
  quantityTotal: 2,
  quantity,
  createdAt: '2026-09-24T10:00:00.000Z',
  updatedAt: '2026-09-24T10:00:00.000Z',
});

// Селектор «приз доступен для розыгрыша» (бриф Task 15): остаток фонда > 0.
// Пустой приз не предлагаем разыграть — серверный декремент атомарен и отказал
// бы (REQ-RWD-010), но ведущему незачем кнопка, которая гарантированно откажет.
describe('isDrawable', () => {
  it('quantity > 0 → приз доступен для розыгрыша', () => {
    expect(isDrawable(prize(1))).toBe(true);
    expect(isDrawable(prize(5))).toBe(true);
  });

  it('quantity === 0 → приз недоступен (фонд исчерпан)', () => {
    expect(isDrawable(prize(0))).toBe(false);
  });
});

// Одна попытка розыгрыша за раз (бриф Task 15, идемпотентность дизайна ф.3 §4):
// drawId — клиентский ключ идемпотентности, поэтому повторный клик до ack НЕ
// порождает новую попытку (null) и не тратит новый drawId — иначе два ключа =
// два розыгрыша = двойной декремент фонда.
describe('startDrawAttempt', () => {
  it('нет pending-попытки и приз доступен → попытка с drawId генератора и prizeId приза', () => {
    const p = prize(1);
    const attempt = startDrawAttempt(p, null, () => '33333333-3333-4333-8333-333333333333');
    expect(attempt).toEqual({ drawId: '33333333-3333-4333-8333-333333333333', prizeId: p.id });
  });

  it('pending-попытка уже есть → null, генератор drawId НЕ вызывается', () => {
    const pending: DrawAttempt = {
      drawId: '44444444-4444-4444-8444-444444444444',
      prizeId: prize(1).id,
    };
    let generated = 0;
    const attempt = startDrawAttempt(prize(1), pending, () => {
      generated += 1;
      return '55555555-5555-4555-8555-555555555555';
    });
    expect(attempt).toBeNull();
    expect(generated).toBe(0);
  });

  it('приз недоступен (quantity 0) → null даже без pending', () => {
    let generated = 0;
    const attempt = startDrawAttempt(prize(0), null, () => {
      generated += 1;
      return '66666666-6666-4666-8666-666666666666';
    });
    expect(attempt).toBeNull();
    expect(generated).toBe(0);
  });
});

// Синхронный бросок генератора drawId (crypto.randomUUID() вне secure context —
// plain-HTTP в LAN) обязан всплывать текстом ошибки панели, а не умирать в
// onClick: иначе ведущий не понимает, почему розыгрыш не пошёл, а pending при
// этом остался бы висеть (фолбэк-генератор запрещён глобальным констрейнтом).
describe('tryStartDrawAttempt', () => {
  it('генератор бросает → ошибка всплывает, попытка НЕ создана (pending не залипнет)', () => {
    const result = tryStartDrawAttempt(prize(1), null, () => {
      throw new TypeError('crypto.randomUUID is not a function');
    });
    expect(result.attempt).toBeNull();
    expect(result.error).toBe(DRAW_ID_GENERATION_FAILED);
  });

  it('генератор бросает при УЖЕ pending-попытке → броска нет, генератор не вызывается повторно', () => {
    const pending: DrawAttempt = {
      drawId: '77777777-7777-4777-8777-777777777777',
      prizeId: prize(1).id,
    };
    let generated = 0;
    const result = tryStartDrawAttempt(prize(1), pending, () => {
      generated += 1;
      throw new TypeError('crypto.randomUUID is not a function');
    });
    expect(result).toEqual({ attempt: null, error: null });
    expect(generated).toBe(0);
  });

  it('успешная генерация → попытка без ошибки (прозрачный pass-through)', () => {
    const p = prize(1);
    const result = tryStartDrawAttempt(p, null, () => '88888888-8888-4888-8888-888888888888');
    expect(result).toEqual({
      attempt: { drawId: '88888888-8888-4888-8888-888888888888', prizeId: p.id },
      error: null,
    });
  });
});

// Безпризовой розыгрыш «Разыграть участника» (ADR-012 §4 / REQ-RWD-002b):
// prizeId null — wire-команда draw.run уходит без ключа prizeId. Тот же
// дисциплинарный паттерн, что у призового: одна попытка за раз, повторный клик
// до ack не тратит новый drawId, бросок генератора — текстом ошибки панели.
describe('startParticipantDrawAttempt', () => {
  it('нет pending-попытки → попытка с drawId генератора и prizeId null', () => {
    const attempt = startParticipantDrawAttempt(null, () => '99999999-9999-4999-8999-999999999999');
    expect(attempt).toEqual({ drawId: '99999999-9999-4999-8999-999999999999', prizeId: null });
  });

  it('pending-попытка уже есть → null, генератор drawId НЕ вызывается', () => {
    const pending: DrawAttempt = {
      drawId: '44444444-4444-4444-8444-444444444444',
      prizeId: prize(1).id,
    };
    let generated = 0;
    const attempt = startParticipantDrawAttempt(pending, () => {
      generated += 1;
      return '55555555-5555-4555-8555-555555555555';
    });
    expect(attempt).toBeNull();
    expect(generated).toBe(0);
  });
});

describe('tryStartParticipantDrawAttempt', () => {
  it('генератор бросает → ошибка всплывает, попытка НЕ создана (pending не залипнет)', () => {
    const result = tryStartParticipantDrawAttempt(null, () => {
      throw new TypeError('crypto.randomUUID is not a function');
    });
    expect(result.attempt).toBeNull();
    expect(result.error).toBe(DRAW_ID_GENERATION_FAILED);
  });

  it('успешная генерация → попытка без ошибки (прозрачный pass-through)', () => {
    const result = tryStartParticipantDrawAttempt(null, () => '66666666-6666-4666-8666-666666666666');
    expect(result).toEqual({
      attempt: { drawId: '66666666-6666-4666-8666-666666666666', prizeId: null },
      error: null,
    });
  });
});

// Баннер победителя (бриф T11, дизайн §5.3 «Розыгрыш»): последний
// lottery.draw.completed лога, payload — схемой app-lottery на границе
// (прецедент lastRoundGains в state/race-tracks.ts), не raw JSON.
const drawEvent = (drawId: string, prizeId: string | null): ProjectedEvent => ({
  type: 'lottery.draw.completed',
  payload: { drawId, prizeId, winnerId: '0f8fad5b-d9cb-469f-a165-70867728950e' },
  actorId: null,
});

describe('lastCompletedDraw', () => {
  it('пустой лог / лог без розыгрышей → null (баннера нет)', () => {
    expect(lastCompletedDraw([])).toBeNull();
    expect(
      lastCompletedDraw([
        { type: 'quiz.question.opened', payload: { questionIndex: 0 }, actorId: null },
      ]),
    ).toBeNull();
  });

  it('один розыгрыш → его payload (призовый и безпризовой)', () => {
    const withPrize = drawEvent('33333333-3333-4333-8333-333333333333', prize(1).id);
    expect(lastCompletedDraw([withPrize])).toEqual(withPrize.payload);
    const noPrize = drawEvent('44444444-4444-4444-8444-444444444444', null);
    expect(lastCompletedDraw([noPrize])).toEqual(noPrize.payload);
  });

  it('несколько розыгрышей → последний в порядке лога', () => {
    const first = drawEvent('55555555-5555-4555-8555-555555555555', prize(1).id);
    const last = drawEvent('66666666-6666-4666-8666-666666666666', null);
    expect(lastCompletedDraw([first, last])).toEqual(last.payload);
    expect(lastCompletedDraw([last, first])).toEqual(first.payload);
  });
});

// Название приза в баннере победителя (T13, извлечение из рендера панели):
// find по локальному списку панели. Три ветки: приз найден → имя; prizeId есть,
// но приз удалён из списка → null (строка без названия — fallback брифа T11);
// безпризовой draw (prizeId null) → null.
describe('drawPrizeName', () => {
  const draw = (prizeId: string | null): CompletedDraw => ({
    drawId: '33333333-3333-4333-8333-333333333333',
    prizeId,
    winnerId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  });

  it('приз найден в списке панели → его название', () => {
    const p = prize(1);
    expect(drawPrizeName(draw(p.id), [p])).toBe('Кубок');
  });

  it('prizeId есть, но приз удалён из списка → null (баннер без названия)', () => {
    expect(drawPrizeName(draw(prize(1).id), [])).toBeNull();
    // Список ещё не загружен (null) — тот же fallback.
    expect(drawPrizeName(draw(prize(1).id), null)).toBeNull();
  });

  it('безпризовой draw (prizeId null) → null', () => {
    expect(drawPrizeName(draw(null), [prize(1)])).toBeNull();
  });

  it('розыгрышей не было (draw null) → null', () => {
    expect(drawPrizeName(null, [prize(1)])).toBeNull();
  });
});
