import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RosterEntry } from '@mymozhem/sdk';
import { questionRevealedPayload, quizSettingsSchema } from '@mymozhem/app-quiz';
import { ApiClient } from '../../api/api-client';
import { ApiError } from '../../api/api-error';
import { listMembers, refreshSession } from '../../api/endpoints';
import { createRejoinRetryListeners, rejoinAsGuest, rejoinFailureAction } from '../../state/guest-rejoin';
import { ConnectionBanner } from '../../components/connection-banner';
import { Logo } from '../../components/logo';
import { RaceTracks } from '../../components/race-tracks';
import { displayNameOf, rosterNames } from '../../components/roster-names';
import { Winners } from '../../components/winners';
import { deriveRoomStatus, projectAnsweredActors, projectLottery, projectQuiz } from '../../state/projections';
import { formatTimer, useQuestionTimer } from '../../state/question-timer';
import { lastRoundGains, myPlace } from '../../state/race-tracks';
import { createRosterEventRefetcher } from '../../state/roster-refetch';
import { decodeAccessClaims, SessionStore, type GuestSession } from '../../state/session';
import { useRoomBinding } from '../../state/use-room-binding';
import { JoinForm } from './join-form';

// Буквенные метки вариантов (золотые <b> в .btn-scene, мокапы component-states-live
// и timer-projector-participant). Вариантов больше, чем букв, — рендер без метки.
const OPTION_LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'];

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
  const rejoinInFlight = useRef(false);
  // Вооружение повтора rejoin (временный отказ): слушатели пробуждения живут,
  // только пока retry вооружён; снимаются на успех/терминал/unmount.
  const [rejoinRetryArmed, setRejoinRetryArmed] = useState(false);

  // Перезаход с новой identity (находка №5): общий путь для авто-входа §5
  // (TTL протух на загрузке) и onSessionDead (кука умерла на живой странице).
  // Гард: один перезаход в полёте — повторный onSessionDead не плодит identity.
  // pending/вооружение retry выставляются ЗДЕСЬ, а не в вызывающем: путь
  // wake-слушателя не проходит через эффект авто-входа (финревью батча B).
  const rejoin = useCallback(async (): Promise<void> => {
    const s = SessionStore.loadGuest();
    if (!s || rejoinInFlight.current) return;
    rejoinInFlight.current = true;
    try {
      const res = await rejoinAsGuest(anonClient, s);
      session.setAccessToken(res.accessToken);
      setRejoined(true);
      setRoomId(res.roomId);
      setAutoJoinPending(false);
      setRejoinRetryArmed(false);
    } catch (e) {
      if (rejoinFailureAction(e) === 'terminal') {
        // Сохранённое отклонено сервером по существу (комната удалена/закрыта)
        // — забываем его и честно показываем форму, а не вечный «Входим…».
        SessionStore.clearGuest();
        setSaved(null);
        setAutoJoinError('Сохранённая сессия недействительна. Войдите заново.');
        setAutoJoinPending(false);
        setRejoinRetryArmed(false);
      } else {
        // Сеть лежит (временный отказ, находка Н13): экран «Входим…», личность
        // не трогаем (решение 4); повтор — wake-слушатели эффекта ниже.
        setAutoJoinPending(true);
        setRejoinRetryArmed(true);
      }
    } finally {
      rejoinInFlight.current = false;
    }
  }, [session]);

  // Повтор rejoin по пробуждению/online (находка Н13, дизайн §3(В)): слушатели
  // живут, только пока вооружён retry — cleanup снимает их на disarm/unmount,
  // иначе сработка после ухода со страницы создала бы сироту-identity на
  // сервере (финревью батча B, Important 2). Не только online: 5xx при ЖИВОЙ
  // сети (рестарт сервера) online не стреляет — догоняем по
  // focus/visibilitychange/pageshow (Important 1); парные события дедупит гард
  // rejoinInFlight внутри rejoin.
  useEffect(() => {
    if (!rejoinRetryArmed) return;
    return createRejoinRetryListeners(() => void rejoin(), window, document);
  }, [rejoinRetryArmed, rejoin]);

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
        setAutoJoinPending(false);
      } catch {
        // pending и retry-слушатели — внутри rejoin: refresh не прошёл, ветка
        // rejoin решает исход (решение 4 / находка Н13).
        await rejoin();
      }
    })();
  }, [autoJoinPending, session, rejoin]);

  const binding = useRoomBinding(roomId, session, {
    onSessionDead: useCallback(() => {
      // Rebind при том же roomId (Review Focus 1): React не перезапустит effect
      // при одинаковом значении deps — сначала отвязываемся (cleanup закроет
      // мёртвое соединение), rejoin следующим тиком установит roomId заново.
      setRoomId(null);
      setTimeout(() => void rejoin(), 0);
    }, [rejoin]),
  });
  const events = binding.events;

  const [members, setMembers] = useState<RosterEntry[]>([]);

  // Ростер (ruling 3): первая загрузка на subscribe (гонка snapshot/replay,
  // I-8)…
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

  // …и событийный рефетч там, где имена появляются на экране (Task 9), плюс
  // live-ростер по core.member.joined: join теперь эмитит public-событие
  // (дизайн §9). Дедуп min 2 с (Review Focus 3): join-шторм на старте события
  // не дёргает REST пачкой; стабильные инстансы — useCallback/useMemo по
  // дисциплине файла.
  const refetchRoster = useCallback(() => {
    if (!roomId) return;
    listMembers(client, roomId)
      .then((r) => setMembers(r.members))
      // Best effort: имена дорисуются при следующем рефетче, состояние
      // соединения и так показывает баннер.
      .catch(() => {});
  }, [roomId, client]);
  const rosterEventRefetch = useMemo(() => createRosterEventRefetcher(refetchRoster), [refetchRoster]);
  useEffect(() => {
    const last = events[events.length - 1];
    if (!last) return;
    rosterEventRefetch(last.type);
  }, [events, rosterEventRefetch]);

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

  // Таймер вопроса (п. 12): durationSec — только из распарсенных настроек
  // (дефолт 30 материализуется на parse; без raw appSettings и без «?? 30»),
  // openedAt — серверный штамп из проекции. «Без лимита»/вопроса нет → null →
  // таймер не рендерится вообще. Хук вызван до ранних return (rules of hooks).
  const question = currentQuestion !== null ? questions[currentQuestion] : undefined;
  const durationSec = question?.durationSec ?? null;
  const timerSec = useQuestionTimer(durationSec, quiz.openedAt);

  // Табло дорожками (дизайн §7): итоги из проекции, прирост — из последнего
  // reveal в логе (lastRoundGains), имена — через displayNameOf (fallback
  // «Гость» внутри). Место — плотный ранг в отсортированном списке (myPlace).
  const gains = lastRoundGains(events);
  const trackEntries = Object.entries(quiz.totals).map(([actorId, total]) => ({
    actorId,
    name: displayNameOf(names, actorId),
    total,
    gain: gains[actorId] ?? 0,
  }));
  const place =
    myId !== null
      ? myPlace(
          [...trackEntries].sort((a, b) => b.total - a.total),
          myId,
        )
      : null;

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
    if (autoJoinPending)
      return (
        <main className="play-page">
          <Logo contour="scene" size="participant" />
          <p className="play-waiting">Входим…</p>
        </main>
      );
    return (
      <main className="play-page">
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
    // Финал (§5.1, п. 18): итоговое полное табло дорожками + победители
    // розыгрыша — только если розыгрыш был (явный гард; Winners и сам вернёт
    // null на пустых draws, но условие читается здесь).
    const hasDraws = Object.keys(lottery.draws).length > 0;
    view = (
      <section>
        <h1 className="play-title">Игра завершена</h1>
        {myId && quiz.totals[myId] !== undefined ? (
          <p className="play-points">Ваши очки: {quiz.totals[myId]}</p>
        ) : null}
        {trackEntries.length > 0 ? (
          <>
            <div className="play-standings-head">
              <span className="play-standings-title">Итоговое табло</span>
              {place !== null ? (
                <span className="play-standings-place">{place}-е место</span>
              ) : null}
            </div>
            <RaceTracks entries={trackEntries} highlightId={myId ?? undefined} contour="scene" />
          </>
        ) : (
          // Пустое табло (лотерея-only, ни одного верного ответа, досрочный
          // finish) — fallback по образцу консоли, без висячего заголовка.
          <p>Очков пока нет.</p>
        )}
        {hasDraws ? (
          <div className="play-winners">
            <Winners draws={lottery.draws} names={names} />
          </div>
        ) : null}
      </section>
    );
  } else if (status === 'CANCELLED') {
    view = <p>Комната отменена организатором.</p>;
  } else if (status !== 'ACTIVE') {
    // Ожидание (п. 7): текст центрирован относительно всей высоты
    // (top: 50% + translateY(-50%) в .play-waiting), логотип и заголовок
    // на центрирование не влияют.
    view = (
      <section>
        <h1 className="play-title">Вы в игре</h1>
        <p className="play-waiting">Ожидаем начала — организатор ещё готовит комнату…</p>
      </section>
    );
  } else if (currentQuestion !== null && quiz.accepting) {
    // Вопрос (§5.1, п. 12): верхняя строка — «Вопросъ N из M» + таймер 40px
    // (только при включённом лимите), отступ перед вариантами 30px, варианты
    // .btn-scene растут по высоте, скролл — страничный.
    view = (
      <section>
        <div className="play-strip">
          <span className="play-kicker">
            {question
              ? `Вопросъ ${currentQuestion + 1} из ${questions.length}`
              : `Вопросъ ${currentQuestion + 1}`}
          </span>
          {timerSec !== null ? <span className="play-timer">{formatTimer(timerSec)}</span> : null}
        </div>
        <h1 className="play-question">
          {question ? question.text : `Вопросъ ${currentQuestion + 1}`}
        </h1>
        {answered ? (
          <p>Ответ принят.</p>
        ) : (
          <ul className="play-options">
            {(question?.options ?? []).map((option, optionIndex) => {
              const letter = OPTION_LETTERS[optionIndex];
              return (
                <li key={optionIndex}>
                  <button
                    type="button"
                    className="btn btn-scene"
                    onClick={() => submitAnswer(optionIndex)}
                  >
                    {letter ? <b>{letter}</b> : null}
                    {option}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {answerError ? (
          <p role="alert" className="play-error">
            {answerError}
          </p>
        ) : null}
      </section>
    );
  } else if (currentQuestion !== null && reveal) {
    // Reveal (§5.1, мокап game-states): вердикт значком+текстом+цветом, очки
    // из payload (единственный публичный источник баллов), «Правильный отвѣтъ»
    // (Приложение A) плашкой, табло — полные дорожки с «это ты» и местом
    // в шапке. correctAnswers клиенту структурно недоступны и не запрашиваются.
    const myPoints = myId
      ? (reveal.awarded.find((a) => a.actorId === myId)?.points ?? 0)
      : 0;
    let verdictText: string;
    let verdictClass = '';
    let verdictIcon = '';
    if (!answered) {
      verdictText = 'Вы не успели ответить.';
    } else if (reveal.correctIndex === undefined) {
      verdictText = 'Ответ принят.';
    } else if (myId !== null && reveal.awarded.some((a) => a.actorId === myId)) {
      // Верно ⇔ актор в awarded (баллы начисляются только за правильный
      // ответ); optionIndex на клиенте недоступен — сравнивать нечего.
      verdictText = 'Верно!';
      verdictClass = ' play-verdict-success';
      verdictIcon = '✓ ';
    } else {
      verdictText = 'Неверно.';
      verdictClass = ' play-verdict-danger';
      verdictIcon = '× ';
    }
    const correctOption =
      reveal.correctIndex !== undefined
        ? questions[currentQuestion]?.options[reveal.correctIndex]
        : undefined;
    view = (
      <section>
        <h1 className={`play-verdict${verdictClass}`}>
          {verdictIcon}
          {verdictText}
        </h1>
        {myPoints > 0 ? <p className="play-points">+{myPoints} очков</p> : null}
        {correctOption ? (
          <div className="play-correct">
            <div className="play-correct-label">Правильный отвѣтъ</div>
            <div className="play-correct-answer">{correctOption}</div>
          </div>
        ) : null}
        {trackEntries.length > 0 ? (
          <>
            <div className="play-standings-head">
              <span className="play-standings-title">Табло</span>
              {place !== null ? (
                <span className="play-standings-place">{place}-е место</span>
              ) : null}
            </div>
            <RaceTracks entries={trackEntries} highlightId={myId ?? undefined} contour="scene" />
          </>
        ) : (
          // Пустое табло — fallback по образцу консоли, без висячего заголовка.
          <p>Очков пока нет.</p>
        )}
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
        {Object.keys(lottery.draws).length > 0 ? (
          <div className="play-winners">
            <Winners draws={lottery.draws} names={names} />
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <main className="play-page">
      <ConnectionBanner state={binding.connectionState} />
      {rejoined ? (
        <p role="status">
          Сессия истекла — вы вошли заново, прежние очки не переносятся.{' '}
          <button type="button" className="btn btn-scene" onClick={() => setRejoined(false)}>
            Понятно
          </button>
        </p>
      ) : null}
      <Logo contour="scene" size="participant" />
      {view}
    </main>
  );
}
