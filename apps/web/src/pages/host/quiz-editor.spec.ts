import { describe, expect, it } from 'vitest';
import { quizSettingsSchema } from '@mymozhem/app-quiz';
import { buildQuizSettings, type QuizFormState } from './quiz-editor';

// buildQuizSettings — чистая функция форма → settings (Task 13): тестируется без
// DOM (раннер node, vite.config.ts). Валидация результата — той же
// quizSettingsSchema, что и на сервере: дрейф клиент/сервер невозможен структурно.
// Числовые поля формы — строки: DOM-контролы отдают строки, конверсия внутри
// buildQuizSettings. durationSec формы (Task 10): строка 5–600 либо
// unlimited → null («без лимита», дизайн §6).

const validForm: QuizFormState = {
  questions: [
    { text: 'Столица Франции?', options: ['Париж', 'Лион'], correctIndex: 0, durationSec: '30', unlimited: false },
    { text: '2+2?', options: ['3', '4', '5'], correctIndex: 1, durationSec: '30', unlimited: false },
  ],
  minAnswerIntervalMs: '0',
  scoringBase: '100',
  scoringStep: '10',
};

// Вопрос с переопределёнными полями длительности поверх валидной заготовки.
const formWithDuration = (durationSec: string, unlimited: boolean): QuizFormState => ({
  ...validForm,
  questions: [{ text: 'Вопрос?', options: ['а', 'б'], correctIndex: 0, durationSec, unlimited }],
});

describe('buildQuizSettings', () => {
  it('maps form rows to quiz settings (correctAnswers из отмеченных радио)', () => {
    const settings = buildQuizSettings(validForm);

    // correctAnswers собираются из радио «правильный» каждого вопроса — индекс
    // в массиве совпадает с индексом вопроса, значение — с выбранным вариантом.
    // Дефолт формы (emptyQuestion) — durationSec '30', unlimited false → 30
    // в parse-результате (дефолт схемы совпадает, но форма шлёт явно).
    expect(quizSettingsSchema.parse(settings)).toEqual({
      questions: [
        { text: 'Столица Франции?', options: ['Париж', 'Лион'], durationSec: 30 },
        { text: '2+2?', options: ['3', '4', '5'], durationSec: 30 },
      ],
      correctAnswers: [0, 1],
      minAnswerIntervalMs: 0,
      scoring: { base: 100, step: 10 },
    });
  });

  it('unlimited → durationSec: null («без лимита», дизайн §6)', () => {
    // Строка длительности при unlimited игнорируется — чекбокс «снимает число»
    // (мокап console-editor): даже мусор в поле не должен доезжать до схемы.
    const settings = buildQuizSettings(formWithDuration('abc', true));

    expect(quizSettingsSchema.parse(settings).questions[0].durationSec).toBeNull();
  });

  it('границы durationSec: 5 и 600 проходят схему, 4 и 601 — общая ошибка формы', () => {
    // Границы — норма схемы app-quiz (5–600); редактор свою валидацию не
    // дублирует, некорректное значение доезжает до safeParse как есть.
    expect(quizSettingsSchema.safeParse(buildQuizSettings(formWithDuration('5', false))).success).toBe(true);
    expect(quizSettingsSchema.safeParse(buildQuizSettings(formWithDuration('600', false))).success).toBe(true);
    expect(quizSettingsSchema.safeParse(buildQuizSettings(formWithDuration('4', false))).success).toBe(false);
    expect(quizSettingsSchema.safeParse(buildQuizSettings(formWithDuration('601', false))).success).toBe(false);
  });

  it('trim текстов, вариантов и durationSec перед сборкой', () => {
    const settings = buildQuizSettings({
      ...validForm,
      questions: [{ text: '  Вопрос?  ', options: [' а ', '  б'], correctIndex: 1, durationSec: ' 45 ', unlimited: false }],
    });

    expect(quizSettingsSchema.parse(settings).questions[0]).toEqual({
      text: 'Вопрос?',
      options: ['а', 'б'],
      durationSec: 45,
    });
  });

  it('reject пустого текста/варианта (quizSettingsSchema.safeParse fail)', () => {
    // Пробельный текст после trim — пустая строка: схема (min(1)) не пускает.
    const noText = buildQuizSettings({
      ...validForm,
      questions: [{ text: '   ', options: ['а', 'б'], correctIndex: 0, durationSec: '30', unlimited: false }],
    });
    expect(quizSettingsSchema.safeParse(noText).success).toBe(false);

    // То же для варианта ответа.
    const noOption = buildQuizSettings({
      ...validForm,
      questions: [{ text: 'Вопрос?', options: ['а', ' '], correctIndex: 0, durationSec: '30', unlimited: false }],
    });
    expect(quizSettingsSchema.safeParse(noOption).success).toBe(false);
  });

  it('reject: один вариант, нецелый/неположительный scoring, нечисловой ввод', () => {
    // options.min(2)
    expect(
      quizSettingsSchema.safeParse(
        buildQuizSettings({
          ...validForm,
          questions: [{ text: 'Вопрос?', options: ['а'], correctIndex: 0, durationSec: '30', unlimited: false }],
        }),
      ).success,
    ).toBe(false);

    // scoring.base positive — 0 не проходит
    expect(
      quizSettingsSchema.safeParse(buildQuizSettings({ ...validForm, scoringBase: '0' })).success,
    ).toBe(false);

    // Нечисловой ввод → NaN → z.number().int() отклоняет
    expect(
      quizSettingsSchema.safeParse(buildQuizSettings({ ...validForm, scoringStep: 'abc' }))
        .success,
    ).toBe(false);

    // Дробный minAnswerIntervalMs — не int
    expect(
      quizSettingsSchema.safeParse(buildQuizSettings({ ...validForm, minAnswerIntervalMs: '1.5' }))
        .success,
    ).toBe(false);
  });
});
