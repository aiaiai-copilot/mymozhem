import { describe, expect, it } from 'vitest';
import { pluralRu } from './plural-ru';

// Русская плюрализация счётных строк (T13): выбор формы по последним цифрам —
// 1/21/101 → one, 2–4/22–24 → few, 5–20/11–14/25/0 → many. Хелпер возвращает
// ТОЛЬКО форму слова, число в строку не вставляет (сборка — у потребителя).
describe('pluralRu', () => {
  const forms: [string, string, string] = ['участник', 'участника', 'участников'];
  const pick = (n: number) => pluralRu(n, ...forms);

  it('1 и составные на 1 (кроме 11) → one', () => {
    expect(pick(1)).toBe('участник');
    expect(pick(21)).toBe('участник');
    expect(pick(101)).toBe('участник');
  });

  it('2–4 и составные на 2–4 (кроме 12–14) → few', () => {
    expect(pick(2)).toBe('участника');
    expect(pick(4)).toBe('участника');
    expect(pick(22)).toBe('участника');
  });

  it('5–20, 11–14, составные на 5–9/0 и ноль → many', () => {
    expect(pick(5)).toBe('участников');
    expect(pick(11)).toBe('участников'); // НЕ few: 11 — исключение
    expect(pick(14)).toBe('участников');
    expect(pick(20)).toBe('участников');
    expect(pick(25)).toBe('участников');
    expect(pick(111)).toBe('участников');
    expect(pick(0)).toBe('участников');
  });
});
