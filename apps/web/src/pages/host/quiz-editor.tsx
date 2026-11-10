import { useState, type FormEvent } from 'react';
import { quizSettingsSchema, type QuizSettings } from '@mymozhem/app-quiz';

// Состояние формы редактора квиза: числовые поля — строки (DOM-контролы отдают
// строки), конверсия — в buildQuizSettings. correctIndex — выбранное радио
// «правильный ответ» внутри вопроса; durationSec/unlimited — лимит времени на
// ответ (дизайн §6): строка 5–600 либо «без лимита» (unlimited).
export interface QuizQuestionForm {
  text: string;
  options: string[];
  correctIndex: number;
  durationSec: string;
  unlimited: boolean;
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
// durationSec (Task 10): unlimited → null (чекбокс «снимает число» — строка
// игнорируется), иначе Number после trim; границы 5–600 — норма схемы.
export const buildQuizSettings = (form: QuizFormState): unknown => ({
  questions: form.questions.map((q) => ({
    text: q.text.trim(),
    options: q.options.map((o) => o.trim()),
    durationSec: q.unlimited ? null : Number(q.durationSec.trim()),
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

// Дефолты нового вопроса (дизайн §6): 30 секунд, лимит включён.
const emptyQuestion = (): QuizQuestionForm => ({
  text: '',
  options: ['', ''],
  correctIndex: 0,
  durationSec: '30',
  unlimited: false,
});

interface QuizEditorProps {
  onSubmit: (settings: QuizSettings) => void;
  busy: boolean;
}

// Редактор квиза (дизайн §5.3 «Редактор», мокап console-editor): вопросы
// (текст, 2–6 вариантов, radio-группа «Правильный ответ» с одним legend —
// п. 9), поле «Время на ответ» с чекбоксом «Без лимита» (§6), scoring
// base/step, minAnswerIntervalMs. Submit → buildQuizSettings →
// quizSettingsSchema.parse на клиенте → onSubmit(settings); организатор
// видит ошибки формы до похода на сервер.
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
          'время на ответ — целое 5–600 с или «без лимита»; ' +
          'баллы и интервал — целые числа (база > 0, шаг и интервал ≥ 0).',
      );
      return;
    }
    setError(null);
    onSubmit(parsed.data);
  };

  return (
    <form className="editor-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend className="editor-legend">Вопросы</legend>
        {questions.map((q, qIndex) => (
          <section className="editor-q-card" key={qIndex}>
            <div className="editor-q-head">
              {/* Полоса номеров/длительностей списка (мокап console-editor):
                  темп виден до открытия вопроса, ∞ — «без лимита». */}
              <span className="editor-q-title">Вопрос {qIndex + 1}</span>
              <span className="editor-q-time">
                {q.unlimited ? '∞' : `${q.durationSec.trim() || '—'}с`}
              </span>
            </div>
            <label className="editor-label">
              Текст вопроса
              <input
                className="editor-input"
                value={q.text}
                onChange={(e) => updateQuestion(qIndex, { text: e.target.value })}
              />
            </label>
            {/* Radio-группа (п. 9): один видимый legend на всю группу,
                у каждого radio — доступное имя; повторяющийся видимый label
                «Правильный» у вариантов убран. */}
            <fieldset className="editor-options">
              <legend>Правильный ответ</legend>
              {q.options.map((option, oIndex) => (
                <div className="editor-opt-row" key={oIndex}>
                  <input
                    type="radio"
                    name={`correct-${qIndex}`}
                    aria-label={`Вариант ${oIndex + 1} — правильный`}
                    checked={q.correctIndex === oIndex}
                    onChange={() => updateQuestion(qIndex, { correctIndex: oIndex })}
                  />
                  <input
                    className="editor-input"
                    value={option}
                    placeholder={`Вариант ${oIndex + 1}`}
                    onChange={(e) => updateOption(qIndex, oIndex, e.target.value)}
                  />
                  {q.options.length > MIN_OPTIONS ? (
                    <button
                      type="button"
                      className="btn btn-quiet editor-remove"
                      onClick={() => removeOption(qIndex, oIndex)}
                    >
                      Удалить
                    </button>
                  ) : null}
                </div>
              ))}
            </fieldset>
            {q.options.length < MAX_OPTIONS ? (
              <button
                type="button"
                className="btn btn-secondary editor-add-option"
                onClick={() => addOption(qIndex)}
              >
                + Добавить вариант
              </button>
            ) : null}
            {/* Время на ответ (§6): число 5–600 либо «без лимита» — чекбокс
                снимает число (поле disabled, значение сохраняется в состоянии). */}
            <span className="editor-label">Время на ответ</span>
            <div className="editor-duration-row">
              <span className="editor-duration-input">
                <input
                  type="number"
                  min={5}
                  max={600}
                  step={1}
                  aria-label="Время на ответ, секунд"
                  value={q.durationSec}
                  disabled={q.unlimited}
                  onChange={(e) => updateQuestion(qIndex, { durationSec: e.target.value })}
                />
                <span className="editor-duration-unit">сек</span>
              </span>
              <label className="editor-nolimit">
                <input
                  type="checkbox"
                  checked={q.unlimited}
                  onChange={(e) => updateQuestion(qIndex, { unlimited: e.target.checked })}
                />
                Без лимита
              </label>
            </div>
            {questions.length > 1 ? (
              <button
                type="button"
                className="btn btn-quiet editor-remove"
                onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== qIndex))}
              >
                Удалить вопрос
              </button>
            ) : null}
          </section>
        ))}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setQuestions((prev) => [...prev, emptyQuestion()])}
        >
          + Добавить вопрос
        </button>
      </fieldset>
      <fieldset className="editor-scoring" disabled={busy}>
        <legend className="editor-legend">Баллы и темп</legend>
        <label className="editor-label">
          Баллы за первый правильный ответ (база)
          <input
            className="editor-input"
            type="number"
            min={1}
            step={1}
            value={scoringBase}
            onChange={(e) => setScoringBase(e.target.value)}
          />
        </label>
        <label className="editor-label">
          Убывание баллов за ответ (шаг)
          <input
            className="editor-input"
            type="number"
            min={0}
            step={1}
            value={scoringStep}
            onChange={(e) => setScoringStep(e.target.value)}
          />
        </label>
        <label className="editor-label">
          Минимальный интервал между ответами, мс
          <input
            className="editor-input"
            type="number"
            min={0}
            step={1}
            value={minAnswerIntervalMs}
            onChange={(e) => setMinAnswerIntervalMs(e.target.value)}
          />
        </label>
      </fieldset>
      {error ? (
        <p role="alert" className="console-error">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary editor-submit" disabled={busy}>
        Сохранить и запустить
      </button>
    </form>
  );
}
