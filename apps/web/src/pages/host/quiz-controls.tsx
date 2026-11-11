import { useEffect, useMemo, useState } from 'react';
import type { ProjectedEvent } from '@mymozhem/sdk';
import {
  gameFinishedPayload,
  questionClosedPayload,
  questionRevealedPayload,
  quizSettingsSchema,
  type QuizState,
} from '@mymozhem/app-quiz';
import { RaceTracks } from '../../components/race-tracks';
import { displayNameOf } from '../../components/roster-names';
import { projectAnsweredActors } from '../../state/projections';
import { pluralRu } from '../../state/plural-ru';
import { lastRoundGains } from '../../state/race-tracks';
import { formatTimer, useQuestionTimer } from '../../state/question-timer';
import { openQuestionLabel } from './open-question-label';

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
  // длины колоды и текстов вопросов — кнопку «Открыть вопрос» глушим, когда
  // вопросы кончились.
  appSettings: Record<string, unknown>;
  // Терминальный статус комнаты: сервер отклонит любую команду в не-ACTIVE
  // комнате — отсекаем заранее (та же дисциплина, что у Members/Prizes).
  disabled: boolean;
  // Число участников ростера (role participant) — знаменатель «не успели»
  // и «N из M ответили»; считает страница (participantsCount).
  participants: number;
  // Невручённые награды для подсказки «Квиз окончен»; null — ещё не загружены
  // (подсказки нет, дизайн п. 18).
  pendingAwards: number | null;
  // «Завершить событие» — главная кнопка экрана «Квиз окончен» (дизайн §5.3);
  // сама команда (completeRoom + confirm) живёт на странице.
  completing: boolean;
  onCompleteEvent: () => void;
  // Одна publish-команда в полёте (находка Н1, решение 3): кнопки команд
  // disabled, пока publish не settle'нулся (settle гарантирован ack-таймаутом
  // T1). Ставит/сбрасывает страница.
  commandPending: boolean;
  // Команды ведущего (clientInitiated по манифесту): quiz.question.opened /
  // quiz.question.closed / quiz.game.finish. Ошибку publish показывает страница.
  onCommand: (type: string, payload: Record<string, unknown>) => void;
  commandError: string | null;
}

// Пульт ведущего квиза (бриф T9, дизайн §5.3 «пульт ведущего»): иерархия
// «статус → текущий момент → следующее действие». Hero = момент + действия;
// ростер reveal — дорожками (RaceTracks, contour console) с приростом из
// lastRoundGains. Кнопок reveal нет — question.revealed и game.finished
// коммитит модуль после close/finish, консоль только потребляет публичные
// события. Разметка/значения — мокапы console-phone-landscape-v2,
// console-reveal-final-button, console-quiz-finished.
export function QuizControls({
  events,
  quiz,
  names,
  appSettings,
  disabled,
  participants,
  pendingAwards,
  completing,
  commandPending,
  onCompleteEvent,
  onCommand,
  commandError,
}: QuizControlsProps) {
  const current = quiz.currentQuestion;
  const next = nextQuestionIndex(quiz);
  // Команды недоступны в терминале комнаты (disabled) и пока предыдущая
  // команда в полёте (commandPending) — второй клик невозможен конструкцией.
  const commandsDisabled = disabled || commandPending;

  // «ещё N — развернуть» (I-5): toggle полного ростера — локальное состояние;
  // между раундами (смена currentQuestion) схлопывается к топ-4.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [current]);

  // Длина колоды и тексты — из публичной проекции appSettings: тот же
  // safeParse по ключу questions, что на play-page (correctAnswers сюда
  // структурно не доезжают). durationSec материализуется дефолтом схемы (30).
  // Хук до early return ниже — хуки безусловны.
  const questions = useMemo(() => {
    const parsed = quizSettingsSchema.shape.questions.safeParse(appSettings.questions);
    return parsed.success ? parsed.data : [];
  }, [appSettings]);
  // Колоды хватило: следующего вопроса нет — open глушим, модуль всё равно
  // отклонил бы индекс вне диапазона.
  const deckExhausted = next >= questions.length;

  // Reveal текущего вопроса: revealed-событие позже close для того же индекса
  // (тот же критерий, что в play/screen). Payload несёт correctIndex и
  // awarded — разбор «верно/неверно/не успели» и плашка ответа.
  const revealPayload = useMemo(() => {
    let revealIdx = -1;
    let closeIdx = -1;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'quiz.question.revealed') {
        if (questionRevealedPayload.parse(e.payload).questionIndex === current) revealIdx = i;
      } else if (e.type === 'quiz.question.closed') {
        if (questionClosedPayload.parse(e.payload).questionIndex === current) closeIdx = i;
      }
    }
    if (revealIdx <= closeIdx) return null;
    return questionRevealedPayload.parse(events[revealIdx].payload);
  }, [events, current]);
  const revealed = revealPayload !== null;

  const answered = useMemo(
    () => (current !== null ? answersCount(events, current) : 0),
    [events, current],
  );

  // Длительности — только schema-parse выше (дефолт 30 материализован схемой),
  // без raw JSON и без «?? 30»: вопроса нет в колоде → null → таймера/суффикса
  // нет вовсе.
  const durationSec = current !== null ? (questions[current]?.durationSec ?? null) : null;
  const nextDurationSec = questions[next]?.durationSec ?? null;
  // Таймер — только в приёме ответов (дизайн §6); «без лимита» (null) → null.
  const timer = useQuestionTimer(quiz.accepting ? durationSec : null, quiz.openedAt);

  // Прирост последнего раунда — из перефолженного лога (дизайн §7),
  // reconnect-safe; имена — displayNameOf с fallback «Гость» внутри.
  const gains = useMemo(() => lastRoundGains(events), [events]);
  const trackEntries = useMemo(
    () =>
      Object.entries(quiz.totals).map(([actorId, total]) => ({
        actorId,
        name: displayNameOf(names, actorId),
        total,
        gain: gains[actorId] ?? 0,
      })),
    [quiz.totals, names, gains],
  );

  // Финальное табло: места из payload game.finished (их посчитал модуль),
  // fallback — totals проекции. На экране «Квиз окончен» дорожки без
  // золотой дельты (мокап console-quiz-finished): прирост — атрибут
  // reveal-момента, не финала.
  const finalStandings = useMemo(() => {
    const finishedEvent = [...events].reverse().find((e) => e.type === 'quiz.game.finished');
    return finishedEvent ? gameFinishedPayload.parse(finishedEvent.payload).standings : undefined;
  }, [events]);
  const finalEntries = useMemo(() => {
    const rows =
      finalStandings ?? Object.entries(quiz.totals).map(([actorId, total]) => ({ actorId, total }));
    return rows.map((r) => ({
      actorId: r.actorId,
      name: displayNameOf(names, r.actorId),
      total: r.total,
      gain: 0,
    }));
  }, [finalStandings, quiz.totals, names]);

  // confirm(): game.finish необратим на сервере (модуль коммитит
  // game.finished) — случайный клик не должен гасить квиз; та же
  // дисциплина, что у «Завершить событие» на console-page.
  const finishQuiz = () => {
    if (window.confirm('Завершить квиз? Это действие необратимо.')) {
      onCommand('quiz.game.finish', {});
    }
  };

  // «Квиз окончен» (бриф T9 Step 5, дизайн п. 10/§5.3): событие живо, квиз
  // окончен. Главная кнопка — «Завершить событие»; подсказка невручённых
  // наград — только если они есть (п. 18); кнопка ими НЕ блокируется
  // (REQ-RWD-009: вручение легально и после завершения).
  if (quiz.finished) {
    const played = current !== null ? current + 1 : 0;
    const allPlayed = questions.length > 0 && played >= questions.length;
    return (
      <>
        <section className="console-hero">
          <div className="console-moment">
            <div className="console-q-label">Квиз окончен</div>
            <div className="console-fh-title">
              {allPlayed
                ? `Все вопросы сыграны (${questions.length})`
                : `Сыграно вопросов: ${played} из ${questions.length}`}
            </div>
            {pendingAwards !== null && pendingAwards > 0 ? (
              <p className="console-fh-sub">
                Осталось вручить наград: {pendingAwards}. Когда всё раздано — завершите событие.
              </p>
            ) : null}
          </div>
          {/* В терминале (событие уже завершено/отменено) действий нет —
              статус показывает заметка страницы. */}
          {!disabled ? (
            <div className="console-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={completing}
                onClick={onCompleteEvent}
              >
                {completing ? 'Завершаем…' : 'Завершить событие'}
              </button>
              <p className="console-fh-note">Комната останется доступной до завершения.</p>
            </div>
          ) : null}
        </section>
        {commandError ? (
          <p role="alert" className="console-error">
            {commandError}
          </p>
        ) : null}
        <section className="console-card">
          <h3 className="console-card-title">Итоговое табло</h3>
          {finalEntries.length > 0 ? (
            <div className="console-tracks">
              <RaceTracks entries={finalEntries} contour="console" topN={expanded ? undefined : 4} />
              {finalEntries.length > 4 ? (
                <button
                  type="button"
                  className="console-tracks-toggle"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded
                    ? 'Свернуть'
                    : `ещё ${finalEntries.length - 4} ${pluralRu(finalEntries.length - 4, 'участник', 'участника', 'участников')} — развернуть`}
                </button>
              ) : null}
            </div>
          ) : (
            <p className="console-muted">Очков пока нет.</p>
          )}
        </section>
      </>
    );
  }

  // Разбор раунда (мокап console-reveal-final-button): верно = awarded
  // reveal-события; неверно = ответили, но не попали; не успели = участники
  // минус ответившие. Clamp на 0 — отображение не уходит в минус, даже если
  // ростер отстаёт от лога.
  const correctCount = revealPayload?.awarded.length ?? 0;
  const wrongCount = Math.max(answered - correctCount, 0);
  const missedCount = Math.max(participants - answered, 0);
  const questionText = current !== null ? (questions[current]?.text ?? null) : null;
  // correctIndex опционален на проводе (вопрос без сконфигурированного ответа) —
  // тогда плашки «Правильный ответ» нет вовсе.
  const correctIndex = revealPayload?.correctIndex;
  const correctText =
    current !== null && correctIndex !== undefined
      ? (questions[current]?.options[correctIndex] ?? null)
      : null;

  return (
    <>
      <section className="console-hero">
        <div className="console-moment">
          {current === null ? (
            <>
              <div className="console-q-label">Квиз не начат</div>
              <p className="console-fh-sub">
                В колоде {questions.length}{' '}
                {pluralRu(questions.length, 'вопрос', 'вопроса', 'вопросов')}. Игроки видят экран
                ожидания.
              </p>
            </>
          ) : (
            <>
              <div className="console-q-label">
                Вопрос {current + 1} из {questions.length} — {quiz.accepting ? 'открыт' : 'закрыт'}
              </div>
              {questionText ? <div className="console-q-text">{questionText}</div> : null}
              {quiz.accepting ? (
                <div className="console-live-row">
                  {timer !== null ? (
                    <div className="console-timer">
                      {formatTimer(timer)}
                      <small>осталось</small>
                    </div>
                  ) : null}
                  <div className="console-answered">
                    <b>{answered}</b> из {participants} ответили
                    <div className="console-answered-bar">
                      <i
                        style={{
                          width: `${participants > 0 ? Math.min((answered / participants) * 100, 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
              {revealed ? (
                <>
                  {correctText !== null ? (
                    <div className="console-correct">
                      <span className="console-ca-label">Правильный ответ</span>
                      <span className="console-ca-value">{correctText}</span>
                    </div>
                  ) : null}
                  <div className="console-round-stats">
                    <div>
                      <b>{correctCount}</b>
                      <span>верно</span>
                    </div>
                    <div>
                      <b>{wrongCount}</b>
                      <span>неверно</span>
                    </div>
                    <div>
                      <b>{missedCount}</b>
                      <span>не успели</span>
                    </div>
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
        <div className="console-actions">
          {quiz.accepting && current !== null ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={commandsDisabled}
                onClick={() => onCommand('quiz.question.closed', { questionIndex: current })}
              >
                Закрыть вопрос
              </button>
              {/* disabled с причиной текстом рядом (дизайн п. 15): второй open
                  до close модуль отклонит, но и нажать его зря не даём. */}
              <button type="button" className="btn btn-secondary" disabled>
                {openQuestionLabel(next, nextDurationSec)}{' '}
                <span className="console-btn-note">— сначала закройте текущий</span>
              </button>
            </>
          ) : deckExhausted && current !== null ? (
            /* Колода кончилась: по иерархии «следующее действие» остаётся
               одно — завершить квиз, он и становится главной кнопкой. */
            <button
              type="button"
              className="btn btn-primary"
              disabled={commandsDisabled}
              onClick={finishQuiz}
            >
              Завершить квиз
            </button>
          ) : (
            <>
              {/* Подпись 1-based для ведущего (openQuestionLabel), payload
                  остаётся 0-based (questionIndex: next) — так ждёт модуль. */}
              <button
                type="button"
                className="btn btn-primary"
                disabled={commandsDisabled || deckExhausted}
                onClick={() => onCommand('quiz.question.opened', { questionIndex: next })}
              >
                {openQuestionLabel(next, nextDurationSec)}
              </button>
              {current !== null ? (
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={commandsDisabled}
                  onClick={finishQuiz}
                >
                  Завершить квиз досрочно
                </button>
              ) : null}
            </>
          )}
        </div>
      </section>
      {commandError ? (
        <p role="alert" className="console-error">
          {commandError}
        </p>
      ) : null}
      {/* После reveal — промежуточное табло дорожками: именно тогда у ведущего
          есть что прокомментировать вслух; totals приехали в payload revealed. */}
      {current !== null && revealed ? (
        <section className="console-card">
          <h3 className="console-card-title">Участники — {participants}</h3>
          {trackEntries.length > 0 ? (
            <div className="console-tracks">
              <RaceTracks entries={trackEntries} contour="console" topN={expanded ? undefined : 4} />
              {trackEntries.length > 4 ? (
                <button
                  type="button"
                  className="console-tracks-toggle"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded
                    ? 'Свернуть'
                    : `ещё ${trackEntries.length - 4} ${pluralRu(trackEntries.length - 4, 'участник', 'участника', 'участников')} — развернуть`}
                </button>
              ) : null}
            </div>
          ) : (
            <p className="console-muted">Очков пока нет.</p>
          )}
        </section>
      ) : null}
    </>
  );
}
