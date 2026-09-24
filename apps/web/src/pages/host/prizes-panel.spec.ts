import { describe, expect, it } from 'vitest';
import type { PrizeResponse } from '@mymozhem/sdk';
import {
  DRAW_ID_GENERATION_FAILED,
  isDrawable,
  startDrawAttempt,
  tryStartDrawAttempt,
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
