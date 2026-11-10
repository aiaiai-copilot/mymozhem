// Подпись главной кнопки reveal (бриф T9, Review Focus 4): номер 1-based для
// ведущего (payload команды остаётся 0-based — перевод только в подписи).
// Длительность «(N с)» — только при числовом durationSec; «без лимита»
// (null) кнопку не утяжеляет. Отдельный модуль, а не quiz-controls.tsx:
// чистая функция рядом со страницей — прецедент host-gate-flow.ts.
export const openQuestionLabel = (index: number, durationSec: number | null): string =>
  durationSec === null
    ? `Открыть вопрос ${index + 1}`
    : `Открыть вопрос ${index + 1} (${durationSec} с)`;
