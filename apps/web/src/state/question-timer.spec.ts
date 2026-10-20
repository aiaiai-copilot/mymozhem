import { describe, expect, it } from 'vitest';
import { formatTimer, remainingSec } from './question-timer';

// Таймер вопроса (quiz v3): durationSec из настроек вопроса, openedAt — серверный
// ISO из payload question.opened. remainingSec — чистая функция от (durationSec,
// openedAt, nowMs): clamp(durationSec - floor(elapsed/1000), 0, durationSec).
describe('remainingSec', () => {
  const now = Date.parse('2026-10-20T12:00:00.000Z');

  it('durationSec = null («без лимита») → null', () => {
    expect(remainingSec(null, '2026-10-20T12:00:00.000Z', now)).toBeNull();
  });

  it('openedAt = null (вопрос не открыт) → null', () => {
    expect(remainingSec(30, null, now)).toBeNull();
  });

  it('открыт ровно сейчас → полный durationSec', () => {
    expect(remainingSec(30, '2026-10-20T12:00:00.000Z', now)).toBe(30);
  });

  // Review Focus 1: elapsed считается от серверного openedAt, floor после деления.
  it('openedAt 20 с назад при durationSec 30 → 10', () => {
    expect(remainingSec(30, '2026-10-20T11:59:40.000Z', now)).toBe(10);
  });

  it('openedAt час назад → 0 (не отрицательное)', () => {
    expect(remainingSec(30, '2026-10-20T11:00:00.000Z', now)).toBe(0);
  });

  // Review Focus 2: часы клиента впереди сервера — openedAt «в будущем» от nowMs;
  // clamp не даёт уйти выше durationSec.
  it('openedAt в будущем → durationSec (не выше)', () => {
    expect(remainingSec(30, '2026-10-20T12:00:10.000Z', now)).toBe(30);
  });
});

describe('formatTimer', () => {
  it('ровно 30 → "0:30"', () => {
    expect(formatTimer(30)).toBe('0:30');
  });

  it('ноль → "0:00"', () => {
    expect(formatTimer(0)).toBe('0:00');
  });

  it('65 → "1:05" (m:ss, секунды с ведущим нулём)', () => {
    expect(formatTimer(65)).toBe('1:05');
  });
});
