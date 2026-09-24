import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RosterEntry } from '@mymozhem/sdk';
import {
  gameFinishedPayload,
  questionRevealedPayload,
  quizSettingsSchema,
} from '@mymozhem/app-quiz';
import { ApiClient } from '../../api/api-client';
import { ApiError } from '../../api/api-error';
import { joinRoom, listMembers, refreshSession } from '../../api/endpoints';
import { ConnectionBanner } from '../../components/connection-banner';
import { rosterNames } from '../../components/roster-names';
import { Standings } from '../../components/standings';
import { Winners } from '../../components/winners';
import { deriveRoomStatus, projectAnsweredActors, projectLottery, projectQuiz } from '../../state/projections';
import { shouldRefetchRoster } from '../../state/roster-refetch';
import { decodeAccessClaims, SessionStore, type GuestSession } from '../../state/session';
import { useRoomBinding } from '../../state/use-room-binding';
import { JoinForm } from './join-form';

// anonClient (ruling): join/refresh — auth:false, access-токена им не нужен,
// поэтому провайдер всегда отдаёт null. Module-level const — это не мутабельное
// состояние: клиент безстейтов, токены живут в SessionStore страницы.
const anonClient = new ApiClient({
  getAccessToken: () => null,
  refresh: () => Promise.resolve(),
});

const answerErrorText = (e: unknown): string => {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'ALREADY_ANSWERED':
        return 'Ответ уже принят.';
      case 'ROUND_NOT_OPEN':
        return 'Приём ответов закрыт.';
      case 'ANSWER_TOO_FAST':
        return 'Слишком быстро — попробуйте ещё раз.';
      default:
        return `Ответ не принят (${e.code}).`;
    }
  }
  return 'Ошибка сети. Ответ не отправлен.';
};

export function PlayPage() {
  const { code } = useParams();
  // Сохранённая гостевая идентификация (код+имя, не токен) — источник авто-входа.
  const [saved, setSaved] = useState<GuestSession | null>(() => SessionStore.loadGuest());
  const [session] = useState(
    () => new SessionStore(async () => (await refreshSession(anonClient)).accessToken),
  );
  // Авторизованный клиент поверх SessionStore — для listMembers (auth:true).
  const [client] = useState(() => new ApiClient(session));
  const [roomId, setRoomId] = useState<string | null>(null);
  const [rejoined, setRejoined] = useState(false);
  // Авто-вход имеет смысл, только если URL не указывает на ДРУГУЮ комнату:
  // чужая ссылка-приглашение — это новый join, а не возобновление сессии.
  const [autoJoinPending, setAutoJoinPending] = useState(
    () => saved !== null && (!code || saved.code === code),
  );
  const [autoJoinError, setAutoJoinError] = useState<string | null>(null);
  const autoJoinStarted = useRef(false);

  // Авто-вход (дизайн §5): сначала silent refresh — refresh-кука жива → та же
  // identity и прежние очки. TTL протух → повторный join создаёт НОВУЮ identity
  // (очки не переносятся, принято для MVP) — честно показываем «вы вошли заново».
  useEffect(() => {
    // StrictMode в dev дёргает effect дважды; повторный join создавал бы вторую
    // identity — страхуемся ref'ом, эффект одноразовый.
    if (!autoJoinPending || autoJoinStarted.current) return;
    autoJoinStarted.current = true;
    const s = SessionStore.loadGuest();
    if (!s) {
      setAutoJoinPending(false);
      return;
    }
    void (async () => {
      try {
        await session.refresh();
        const token = session.getAccessToken();
        const resumedRoomId = token ? decodeAccessClaims(token).roomId : undefined;
        if (!resumedRoomId) throw new Error('refreshed token without roomId');
        setRoomId(resumedRoomId);
      } catch {
        try {
          const res = await joinRoom(anonClient, { code: s.code, displayName: s.displayName });
          session.setAccessToken(res.accessToken);
          const claims = decodeAccessClaims(res.accessToken);
          if (!claims.roomId) throw new Error('join token without roomId');
          setRejoined(true);
          setRoomId(claims.roomId);
        } catch {
          // Сохранённое больше не валидно (комната удалена/закрыта) — забываем
          // его и честно показываем форму, а не вечный «Входим…».
          SessionStore.clearGuest();
          setSaved(null);
          setAutoJoinError('Сохранённая сессия недействительна. Войдите заново.');
        }
      } finally {
        setAutoJoinPending(false);
      }
    })();
  }, [autoJoinPending, session]);

  const binding = useRoomBinding(roomId, session);
  const events = binding.events;

  const [members, setMembers] = useState<RosterEntry[]>([]);

  // Ростер (ruling 3): join не эмитит событий — первая загрузка на subscribe…
  useEffect(() => {
    if (!roomId) return;
    let stale = false;
    listMembers(client, roomId)
      .then((r) => {
        if (!stale) setMembers(r.members);
      })
      // Best effort: имена дорисуются при следующем событийном рефетче,
      // состояние соединения и так показывает баннер.
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [roomId, client]);

  // …и событийный рефетч там, где имена появляются на экране (Task 9).
  useEffect(() => {
    const last = events[events.length - 1];
    if (!roomId || !last || !shouldRefetchRoster(last.type)) return;
    listMembers(client, roomId)
      .then((r) => setMembers(r.members))
      .catch(() => {});
  }, [events, roomId, client]);

  const names = useMemo(() => rosterNames(members), [members]);

  // recordedAt — момент приёма: wire его не несёт (I-1); влияет только на
  // отображение, баллы едут в payload question.revealed.
  const quiz = projectQuiz(events, new Date().toISOString());
  const lottery = projectLottery(events, new Date().toISOString());
  const status = deriveRoomStatus(events);
  const currentQuestion = quiz.currentQuestion;

  const myId = useMemo(() => {
    const token = session.getAccessToken();
    return token ? decodeAccessClaims(token).sub : null;
    // session — стабилен; перечитываем claims на каждый переход roomId
    // (токен ставится до setRoomId в обоих флоу входа).
  }, [session, roomId]);

  // Публичная проекция appSettings (REQ-CORE-008): correctAnswers сюда
  // структурно не доезжают, поэтому парсим только public-ключ questions —
  // полной quizSettingsSchema клиенту не собрать и не нужно.
  const questions = useMemo(() => {
    const parsed = quizSettingsSchema.shape.questions.safeParse(binding.appSettings.questions);
    return parsed.success ? parsed.data : [];
  }, [binding.appSettings]);

  // Reveal текущего вопроса: revealed-событие позже close для того же индекса.
  const reveal = useMemo(() => {
    let revealIndex = -1;
    let closeIndex = -1;
    events.forEach((e, i) => {
      const qi = (e.payload as { questionIndex?: unknown }).questionIndex;
      if (qi !== currentQuestion) return;
      if (e.type === 'quiz.question.revealed') revealIndex = i;
      else if (e.type === 'quiz.question.closed') closeIndex = i;
    });
    return revealIndex > closeIndex
      ? questionRevealedPayload.parse(events[revealIndex].payload)
      : null;
  }, [events, currentQuestion]);

  // Локальный ack «Ответ принят» — мгновенная обратная связь до прихода
  // собственного события по fan-out; сбрасывается на смену вопроса.
  const [answerAck, setAnswerAck] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  useEffect(() => {
    setAnswerAck(false);
    setAnswerError(null);
  }, [currentQuestion]);

  // quiz.answers на клиенте ВСЕГДА пуст (answer.submitted — module-private),
  // поэтому факт «я ответил» выводим из публичных quiz.answer.accepted —
  // проекция переживает перефолд/reload (accept едет в snapshot).
  const answeredActors = useMemo(
    () =>
      currentQuestion !== null
        ? projectAnsweredActors(events, currentQuestion)
        : new Set<string>(),
    [events, currentQuestion],
  );

  const submitAnswer = (optionIndex: number) => {
    if (currentQuestion === null) return;
    setAnswerError(null);
    void binding
      .publish('quiz.answer.submitted', { questionIndex: currentQuestion, optionIndex })
      .then(() => setAnswerAck(true))
      .catch((e: unknown) => setAnswerError(answerErrorText(e)));
  };

  if (!roomId) {
    if (autoJoinPending) return <p>Входим…</p>;
    return (
      <main>
        <JoinForm
          codeFromUrl={code}
          initialDisplayName={saved?.displayName}
          initialError={autoJoinError}
          client={anonClient}
          session={session}
          onJoined={setRoomId}
        />
      </main>
    );
  }

  const myAnswered = myId !== null && answeredActors.has(myId);
  const answered = answerAck || myAnswered;

  let view;
  if (quiz.finished || status === 'COMPLETED') {
    // Финал: итоговое табло (места из payload game.finished, если событие было)
    // + победители розыгрыша (дизайн §4).
    const finishedEvent = [...events].reverse().find((e) => e.type === 'quiz.game.finished');
    const finalStandings = finishedEvent
      ? gameFinishedPayload.parse(finishedEvent.payload).standings
      : undefined;
    view = (
      <section>
        <h1>Игра завершена</h1>
        {myId && quiz.totals[myId] !== undefined ? <p>Ваши очки: {quiz.totals[myId]}</p> : null}
        <Standings standings={finalStandings} totals={quiz.totals} names={names} />
        <Winners draws={lottery.draws} names={names} />
      </section>
    );
  } else if (status === 'CANCELLED') {
    view = <p>Комната отменена организатором.</p>;
  } else if (status !== 'ACTIVE') {
    view = <p>Вы в игре. Ожидаем начала — организатор ещё готовит комнату…</p>;
  } else if (currentQuestion !== null && quiz.accepting) {
    const question = questions[currentQuestion];
    view = (
      <section>
        <h1>{question ? question.text : `Вопрос ${currentQuestion + 1}`}</h1>
        {answered ? (
          <p>Ответ принят.</p>
        ) : (
          <ul>
            {(question?.options ?? []).map((option, optionIndex) => (
              <li key={optionIndex}>
                <button type="button" onClick={() => submitAnswer(optionIndex)}>
                  {option}
                </button>
              </li>
            ))}
          </ul>
        )}
        {answerError ? <p role="alert">{answerError}</p> : null}
      </section>
    );
  } else if (currentQuestion !== null && reveal) {
    // Reveal: верно/неверно + очки из payload (единственный публичный источник
    // баллов); correctAnswers клиенту структурно недоступны и не запрашиваются.
    const myPoints = myId
      ? (reveal.awarded.find((a) => a.actorId === myId)?.points ?? 0)
      : 0;
    const verdict = !answered
      ? 'Вы не успели ответить.'
      : reveal.correctIndex === undefined
        ? 'Ответ принят.'
        : // Верно ⇔ актор в awarded (баллы начисляются только за правильный
          // ответ); optionIndex на клиенте недоступен — сравнивать нечего.
          myId !== null && reveal.awarded.some((a) => a.actorId === myId)
          ? 'Верно!'
          : 'Неверно.';
    const correctOption =
      reveal.correctIndex !== undefined
        ? questions[currentQuestion]?.options[reveal.correctIndex]
        : undefined;
    view = (
      <section>
        <h1>{verdict}</h1>
        {myPoints > 0 ? <p>+{myPoints} очков</p> : null}
        {correctOption ? <p>Правильный ответ: {correctOption}</p> : null}
        <Standings totals={quiz.totals} names={names} />
      </section>
    );
  } else if (currentQuestion !== null) {
    view = <p>Ответы закрыты, ждём результатов…</p>;
  } else {
    // ACTIVE без открытого вопроса: ждём первый вопрос; в лотерейной комнате
    // здесь же появляются победители по мере розыгрышей.
    view = (
      <section>
        <p>Игра идёт. Ждём вопрос…</p>
        <Winners draws={lottery.draws} names={names} />
      </section>
    );
  }

  return (
    <main>
      <ConnectionBanner state={binding.connectionState} />
      {rejoined ? (
        <p role="status">
          Сессия истекла — вы вошли заново, прежние очки не переносятся.{' '}
          <button type="button" onClick={() => setRejoined(false)}>
            Понятно
          </button>
        </p>
      ) : null}
      {view}
    </main>
  );
}
