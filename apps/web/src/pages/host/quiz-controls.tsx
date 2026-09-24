import { useMemo } from 'react';
import type { ProjectedEvent } from '@mymozhem/sdk';
import { gameFinishedPayload, quizSettingsSchema, type QuizState } from '@mymozhem/app-quiz';
import { Standings } from '../../components/standings';
import { projectAnsweredActors } from '../../state/projections';

// N следующего вопроса (бриф Task 14): до первого open — 0, дальше
// currentQuestion + 1. То же значение уходит в payload quiz.question.opened.
export const nextQuestionIndex = (quiz: QuizState): number =>
  quiz.currentQuestion === null ? 0 : quiz.currentQuestion + 1;

// Счётчик ответов — distinct actorId среди ПУБЛИЧНЫХ quiz.answer.accepted
// текущего вопроса. quiz.answer.submitted — module-private (манифест app-quiz),
// до клиента он не доезжает, поэтому строить счётчик на нём нельзя; fold тот
// же, что у projectAnsweredActors — переиспользуем его, а не дублируем цикл.
export const answersCount = (events: ProjectedEvent[], questionIndex: number): number =>
  projectAnsweredActors(events, questionIndex).size;

interface QuizControlsProps {
  events: ProjectedEvent[];
  quiz: QuizState;
  names: Map<string, string>;
  // Публичная проекция appSettings из snapshot (REQ-CORE-008): нужна для
  // длины колоды — кнопку «Открыть вопрос» глушим, когда вопросы кончились.
  appSettings: Record<string, unknown>;
  // Терминальный статус комнаты: сервер отклонит любую команду в не-ACTIVE
  // комнате — отсекаем заранее (та же дисциплина, что у Members/Prizes).
  disabled: boolean;
  // Команды ведущего (clientInitiated по манифесту): quiz.question.opened /
  // quiz.question.closed / quiz.game.finish. Ошибку publish показывает страница.
  onCommand: (type: string, payload: Record<string, unknown>) => void;
  commandError: string | null;
}

// Пульт ведущего квиза (бриф Task 14): open/close/finish + счётчик ответов +
// табло. Кнопок reveal нет — question.revealed и game.finished коммитит модуль
// после close/finish, консоль только потребляет публичные события.
export function QuizControls({
  events,
  quiz,
  names,
  appSettings,
  disabled,
  onCommand,
  commandError,
}: QuizControlsProps) {
  const current = quiz.currentQuestion;
  const next = nextQuestionIndex(quiz);

  // Длина колоды — из публичной проекции appSettings: тот же safeParse по ключу
  // questions, что на play-page (correctAnswers сюда структурно не доезжают).
  // Хук до early return ниже — хуки безусловны.
  const questions = useMemo(() => {
    const parsed = quizSettingsSchema.shape.questions.safeParse(appSettings.questions);
    return parsed.success ? parsed.data : [];
  }, [appSettings]);
  // Колоды хватило: следующего вопроса нет — open глушим, модуль всё равно
  // отклонил бы индекс вне диапазона.
  const deckExhausted = next >= questions.length;

  // Reveal текущего вопроса: revealed-событие позже close для того же индекса
  // (тот же критерий, что в play/screen).
  const revealed = useMemo(() => {
    let revealIndex = -1;
    let closeIndex = -1;
    events.forEach((e, i) => {
      const qi = (e.payload as { questionIndex?: unknown }).questionIndex;
      if (qi !== current) return;
      if (e.type === 'quiz.question.revealed') revealIndex = i;
      else if (e.type === 'quiz.question.closed') closeIndex = i;
    });
    return revealIndex > closeIndex;
  }, [events, current]);

  const answered = useMemo(
    () => (current !== null ? answersCount(events, current) : 0),
    [events, current],
  );

  // Финальное табло: места из payload game.finished (их посчитал модуль),
  // промежуточное — totals проекции.
  const finalStandings = useMemo(() => {
    const finishedEvent = [...events].reverse().find((e) => e.type === 'quiz.game.finished');
    return finishedEvent ? gameFinishedPayload.parse(finishedEvent.payload).standings : undefined;
  }, [events]);

  if (quiz.finished) {
    return (
      <section>
        <h2>Квиз завершён</h2>
        <Standings standings={finalStandings} totals={quiz.totals} names={names} />
      </section>
    );
  }

  return (
    <section>
      <h2>Ведение квиза</h2>
      {current !== null ? (
        <p>
          {quiz.accepting
            ? `Идёт вопрос ${current + 1} — приём ответов открыт.`
            : `Вопрос ${current + 1} закрыт.`}{' '}
          Ответов: {answered}
        </p>
      ) : null}
      <p>
        {/* disabled, пока accepting: второй open до close модуль отклонит,
            но и не даём ведущему нажать его зря; deckExhausted — вопросы
            кончились. Подпись 1-based для ведущего (как статус-строка выше),
            а payload остаётся 0-based (questionIndex: next) — так ждёт модуль. */}
        <button
          type="button"
          disabled={disabled || quiz.accepting || deckExhausted}
          onClick={() => onCommand('quiz.question.opened', { questionIndex: next })}
        >
          Открыть вопрос {next + 1}
        </button>{' '}
        <button
          type="button"
          disabled={disabled || !quiz.accepting || current === null}
          onClick={() => {
            if (current !== null) onCommand('quiz.question.closed', { questionIndex: current });
          }}
        >
          Закрыть вопрос
        </button>{' '}
        {/* confirm(): game.finish необратим на сервере (модуль коммитит
            game.finished) — случайный клик не должен гасить квиз; та же
            дисциплина, что у «Завершить событие» на console-page. */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (window.confirm('Завершить квиз? Это действие необратимо.')) {
              onCommand('quiz.game.finish', {});
            }
          }}
        >
          Завершить квиз
        </button>
      </p>
      {commandError ? <p role="alert">{commandError}</p> : null}
      {/* После reveal — промежуточное табло: именно тогда у ведущего есть что
          прокомментировать вслух; totals приехали в payload revealed. */}
      {current !== null && revealed ? <Standings totals={quiz.totals} names={names} /> : null}
    </section>
  );
}
