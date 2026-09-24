import { useState, type FormEvent } from 'react';
import { quizSettingsSchema, type QuizSettings } from '@mymozhem/app-quiz';

// Состояние формы редактора квиза: числовые поля — строки (DOM-контролы отдают
// строки), конверсия — в buildQuizSettings. correctIndex — выбранное радио
// «правильный ответ» внутри вопроса.
export interface QuizQuestionForm {
  text: string;
  options: string[];
  correctIndex: number;
}

export interface QuizFormState {
  questions: QuizQuestionForm[];
  minAnswerIntervalMs: string;
  scoringBase: string;
  scoringStep: string;
}

// Чистая сборка settings из формы (дизайн Task 13): trim + строки → числа.
// Валидации здесь нет нарочно — её делает quizSettingsSchema у вызывающего
// (та же схема, что серверная: дрейф невозможен структурно, REQ-CTR-005);
// некорректный ввод доезжает до схемы как есть (NaN, пустые строки после trim).
export const buildQuizSettings = (form: QuizFormState): unknown => ({
  questions: form.questions.map((q) => ({
    text: q.text.trim(),
    options: q.options.map((o) => o.trim()),
  })),
  // correctAnswers — из отмеченных радио: индекс в массиве = индекс вопроса.
  correctAnswers: form.questions.map((q) => q.correctIndex),
  minAnswerIntervalMs: Number(form.minAnswerIntervalMs),
  scoring: { base: Number(form.scoringBase), step: Number(form.scoringStep) },
});

// Ограничения редактора: схема задаёт только min(2) вариантов; верхняя граница 6 —
// UX-рамка UI-среза (на проекторе больше не читается), не контракт.
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

const emptyQuestion = (): QuizQuestionForm => ({ text: '', options: ['', ''], correctIndex: 0 });

interface QuizEditorProps {
  onSubmit: (settings: QuizSettings) => void;
  busy: boolean;
}

// Редактор квиза (дизайн Task 13): вопросы (текст, 2–6 вариантов, радио
// «правильный»), scoring base/step, minAnswerIntervalMs. Submit →
// buildQuizSettings → quizSettingsSchema.parse на клиенте → onSubmit(settings);
// организатор видит ошибки формы до похода на сервер.
export function QuizEditor({ onSubmit, busy }: QuizEditorProps) {
  const [questions, setQuestions] = useState<QuizQuestionForm[]>([emptyQuestion()]);
  const [minAnswerIntervalMs, setMinAnswerIntervalMs] = useState('0');
  const [scoringBase, setScoringBase] = useState('100');
  const [scoringStep, setScoringStep] = useState('10');
  const [error, setError] = useState<string | null>(null);

  const updateQuestion = (index: number, patch: Partial<QuizQuestionForm>) => {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  };

  const updateOption = (qIndex: number, oIndex: number, value: string) => {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i === qIndex ? { ...q, options: q.options.map((o, j) => (j === oIndex ? value : o)) } : q,
      ),
    );
  };

  const addOption = (qIndex: number) => {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i === qIndex && q.options.length < MAX_OPTIONS ? { ...q, options: [...q.options, ''] } : q,
      ),
    );
  };

  const removeOption = (qIndex: number, oIndex: number) => {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIndex || q.options.length <= MIN_OPTIONS) return q;
        const options = q.options.filter((_, j) => j !== oIndex);
        // Удаление сдвигает индексы: правильный за удалённым — смещаем; удалён
        // сам правильный — откатываем на первый вариант (иначе correctIndex
        // указывал бы за пределы массива).
        const correctIndex =
          oIndex === q.correctIndex
            ? 0
            : oIndex < q.correctIndex
              ? q.correctIndex - 1
              : q.correctIndex;
        return { ...q, options, correctIndex };
      }),
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = quizSettingsSchema.safeParse(
      buildQuizSettings({ questions, minAnswerIntervalMs, scoringBase, scoringStep }),
    );
    if (!parsed.success) {
      // Схема — единственный источник правил; текст человекочитаемый, без
      // вывода zod-issues (они на английском и про пути, не про смысл).
      setError(
        'Проверьте форму: у каждого вопроса нужны текст и минимум 2 непустых варианта; ' +
          'баллы и интервал — целые числа (база > 0, шаг и интервал ≥ 0).',
      );
      return;
    }
    setError(null);
    onSubmit(parsed.data);
  };

  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend>Вопросы</legend>
        {questions.map((q, qIndex) => (
          <fieldset key={qIndex}>
            <legend>Вопрос {qIndex + 1}</legend>
            <label>
              Текст вопроса
              <input
                value={q.text}
                onChange={(e) => updateQuestion(qIndex, { text: e.target.value })}
              />
            </label>
            <ul>
              {q.options.map((option, oIndex) => (
                <li key={oIndex}>
                  <label>
                    <input
                      type="radio"
                      name={`correct-${qIndex}`}
                      checked={q.correctIndex === oIndex}
                      onChange={() => updateQuestion(qIndex, { correctIndex: oIndex })}
                    />
                    Правильный
                  </label>
                  <input
                    value={option}
                    placeholder={`Вариант ${oIndex + 1}`}
                    onChange={(e) => updateOption(qIndex, oIndex, e.target.value)}
                  />
                  {q.options.length > MIN_OPTIONS ? (
                    <button type="button" onClick={() => removeOption(qIndex, oIndex)}>
                      Удалить вариант
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {q.options.length < MAX_OPTIONS ? (
              <button type="button" onClick={() => addOption(qIndex)}>
                Добавить вариант
              </button>
            ) : null}
            {questions.length > 1 ? (
              <button
                type="button"
                onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== qIndex))}
              >
                Удалить вопрос
              </button>
            ) : null}
          </fieldset>
        ))}
        <button type="button" onClick={() => setQuestions((prev) => [...prev, emptyQuestion()])}>
          Добавить вопрос
        </button>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Баллы и темп</legend>
        <label>
          Баллы за первый правильный ответ (база)
          <input
            type="number"
            min={1}
            step={1}
            value={scoringBase}
            onChange={(e) => setScoringBase(e.target.value)}
          />
        </label>
        <label>
          Убывание баллов за ответ (шаг)
          <input
            type="number"
            min={0}
            step={1}
            value={scoringStep}
            onChange={(e) => setScoringStep(e.target.value)}
          />
        </label>
        <label>
          Минимальный интервал между ответами, мс
          <input
            type="number"
            min={0}
            step={1}
            value={minAnswerIntervalMs}
            onChange={(e) => setMinAnswerIntervalMs(e.target.value)}
          />
        </label>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={busy}>
        Сохранить и запустить
      </button>
    </form>
  );
}
