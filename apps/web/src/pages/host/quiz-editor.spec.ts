import { describe, expect, it } from 'vitest';
import { quizSettingsSchema } from '@mymozhem/app-quiz';
import { buildQuizSettings, type QuizFormState } from './quiz-editor';

// buildQuizSettings — чистая функция форма → settings (Task 13): тестируется без
// DOM (раннер node, vite.config.ts). Валидация результата — той же
// quizSettingsSchema, что и на сервере: дрейф клиент/сервер невозможен структурно.
// Числовые поля формы — строки: DOM-контролы отдают строки, конверсия внутри
// buildQuizSettings.

const validForm: QuizFormState = {
  questions: [
    { text: 'Столица Франции?', options: ['Париж', 'Лион'], correctIndex: 0 },
    { text: '2+2?', options: ['3', '4', '5'], correctIndex: 1 },
  ],
  minAnswerIntervalMs: '0',
  scoringBase: '100',
  scoringStep: '10',
};

describe('buildQuizSettings', () => {
  it('maps form rows to quiz settings (correctAnswers из отмеченных радио)', () => {
    const settings = buildQuizSettings(validForm);

    // correctAnswers собираются из радио «правильный» каждого вопроса — индекс
    // в массиве совпадает с индексом вопроса, значение — с выбранным вариантом.
    expect(quizSettingsSchema.parse(settings)).toEqual({
      questions: [
        { text: 'Столица Франции?', options: ['Париж', 'Лион'] },
        { text: '2+2?', options: ['3', '4', '5'] },
      ],
      correctAnswers: [0, 1],
      minAnswerIntervalMs: 0,
      scoring: { base: 100, step: 10 },
    });
  });

  it('trim текстов и вариантов перед сборкой', () => {
    const settings = buildQuizSettings({
      ...validForm,
      questions: [{ text: '  Вопрос?  ', options: [' а ', '  б'], correctIndex: 1 }],
    });

    expect(quizSettingsSchema.parse(settings).questions[0]).toEqual({
      text: 'Вопрос?',
      options: ['а', 'б'],
    });
  });

  it('reject пустого текста/варианта (quizSettingsSchema.safeParse fail)', () => {
    // Пробельный текст после trim — пустая строка: схема (min(1)) не пускает.
    const noText = buildQuizSettings({
      ...validForm,
      questions: [{ text: '   ', options: ['а', 'б'], correctIndex: 0 }],
    });
    expect(quizSettingsSchema.safeParse(noText).success).toBe(false);

    // То же для варианта ответа.
    const noOption = buildQuizSettings({
      ...validForm,
      questions: [{ text: 'Вопрос?', options: ['а', ' '], correctIndex: 0 }],
    });
    expect(quizSettingsSchema.safeParse(noOption).success).toBe(false);
  });

  it('reject: один вариант, нецелый/неположительный scoring, нечисловой ввод', () => {
    // options.min(2)
    expect(
      quizSettingsSchema.safeParse(
        buildQuizSettings({
          ...validForm,
          questions: [{ text: 'Вопрос?', options: ['а'], correctIndex: 0 }],
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
