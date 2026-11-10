// Компактная плотность вопроса проектора (дизайн п. 8, §5.2; мокап
// projector-long-content: «при длинном вопросе или более чем четырёх
// вариантах включается компактная плотность») — уменьшенные кегли/отступы,
// чтобы длинный экран не скроллился. «Длинный» мокапы числом не определяют:
// порог COMPACT_TEXT_LENGTH — допущение имплементера T8 (между эталонным
// коротким вопросом ~52 символа и длинным ~130), к ревью.

export const COMPACT_TEXT_LENGTH = 100;

// textLength — длина текста вопроса (0, если вопрос ещё не распарсен),
// optionCount — число вариантов. Больше четырёх вариантов — всегда compact.
export function isCompactQuestion(textLength: number, optionCount: number): boolean {
  return optionCount > 4 || textLength > COMPACT_TEXT_LENGTH;
}
