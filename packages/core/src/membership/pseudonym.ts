import { randomInt } from 'node:crypto';

// Серверные псевдонимы гостей (ADR-012 §3, уточнение REQ-ID-003): система не
// требует реального имени ни в одном сценарии. Словарь — константа (решение
// §0.1 дизайна); случайность — crypto.randomInt, НЕ Math.random (дух REQ-RWD-011).
const NOUNS = [
  'Барсук', 'Белка', 'Ворона', 'Выдра', 'Ёж', 'Журавль', 'Заяц', 'Иволга', 'Кабан', 'Коза',
  'Коршун', 'Кошка', 'Куница', 'Ласка', 'Лиса', 'Лось', 'Мангуст', 'Медведь', 'Нерпа', 'Олень',
  'Орлан', 'Панда', 'Песец', 'Рысь', 'Сайга', 'Соболь', 'Сорока', 'Тигр', 'Уж', 'Филин',
  'Хорёк', 'Цапля', 'Чайка', 'Шакал', 'Щегол', 'Ястреб', 'Бобр', 'Гусь', 'Дрофа', 'Енот',
  'Жерех', 'Зубр', 'Крот', 'Лебедь', 'Мартышка', 'Ондатра', 'Пума', 'Росомаха', 'Сокол', 'Тюлень',
] as const;

export type RandomInt = (bound: number) => number;

// Уникальность — в рамках комнаты (пересечение с активным ростером — retry).
// 5 попыток «Слово-NN» (10–99), затем расширение «Слово-NNN» (100–999);
// теоретическое исчерпание — детерминированный скан suffix от 10 вверх
// (всегда терминирует; на практике недостижим — 50 слов × 990 номеров).
export function generatePseudonym(taken: ReadonlySet<string>, rnd: RandomInt = randomInt): string {
  const word = () => NOUNS[rnd(NOUNS.length)];
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${word()}-${10 + rnd(90)}`;
    if (!taken.has(candidate)) return candidate;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${word()}-${100 + rnd(900)}`;
    if (!taken.has(candidate)) return candidate;
  }
  const base = word();
  for (let suffix = 10; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
