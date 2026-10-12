import { generatePseudonym } from './pseudonym';

// Детерминизм — инжекцией rnd (bound) => number. sequence([...]) отдаёт значения по кругу.
const sequence = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('generatePseudonym (ADR-012 §3)', () => {
  it('формат «Слово-NN»: словарное существительное + число 10–99', () => {
    const name = generatePseudonym(new Set(), sequence([0, 32]));
    expect(name).toMatch(/^[А-ЯЁ][а-яё]+-\d{2}$/);
  });
  it('retry при коллизии с активным ростером', () => {
    const first = generatePseudonym(new Set(), sequence([0, 42]));
    const second = generatePseudonym(new Set([first]), sequence([0, 42, 1, 42]));
    expect(second).not.toBe(first);
  });
  it('исчерпание 10–99 по слову ведёт к расширению диапазона 100–999', () => {
    // Ruling контроллера B-pre.2: слово НЕ хардкодится — словарь начинается с
    // «Барсук», дословный «Лиса»-пин брифа был бы красным. Выбранное rnd=[0,0]
    // существительное выводится пробным вызовом, exhaustion-сет строится для него.
    const probe = generatePseudonym(new Set(), sequence([0, 0]));
    const word = probe.slice(0, probe.indexOf('-'));
    const taken = new Set(Array.from({ length: 90 }, (_, i) => `${word}-${10 + i}`));
    const name = generatePseudonym(taken, sequence([0, 0]));
    expect(name).toMatch(new RegExp(`^${word}-(1\\d\\d|\\d{4})$`));
  });
});
