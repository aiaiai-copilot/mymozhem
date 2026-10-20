// Русская плюрализация счётных строк (T13): выбор формы по последним цифрам
// числа — 1/21/101 → one, 2–4/22–24 → few, 5–20/11–14/25/0 → many. Возвращает
// ТОЛЬКО форму слова: число в строку не вставляется, сборка («ещё N участников»)
// — у потребителя, потому что порядок «число/слово» и обрамление разные
// (label:count у hero консоли, «ещё N …» у дорожек).
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = mod100 % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
