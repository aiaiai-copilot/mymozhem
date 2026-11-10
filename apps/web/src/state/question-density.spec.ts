import { describe, expect, it } from 'vitest';
import { COMPACT_TEXT_LENGTH, isCompactQuestion } from './question-density';

// Компактная плотность вопроса проектора (дизайн п. 8): длинный вопрос
// (> COMPACT_TEXT_LENGTH символов) или более четырёх вариантов.

describe('isCompactQuestion', () => {
  it('короткий вопрос, 4 варианта → обычная плотность', () => {
    expect(isCompactQuestion(52, 4)).toBe(false);
  });

  it('более четырёх вариантов → компактная (мокап projector-long-content)', () => {
    expect(isCompactQuestion(20, 5)).toBe(true);
    expect(isCompactQuestion(20, 6)).toBe(true);
  });

  it('ровно 4 варианта → обычная («более четырёх» — строго)', () => {
    expect(isCompactQuestion(20, 4)).toBe(false);
  });

  it('длинный текст (> COMPACT_TEXT_LENGTH) → компактная', () => {
    expect(isCompactQuestion(COMPACT_TEXT_LENGTH + 1, 4)).toBe(true);
  });

  it('текст ровно на пороге → обычная', () => {
    expect(isCompactQuestion(COMPACT_TEXT_LENGTH, 4)).toBe(false);
  });

  it('вопрос не распарсен (textLength 0, вариантов 0) → обычная', () => {
    expect(isCompactQuestion(0, 0)).toBe(false);
  });
});
