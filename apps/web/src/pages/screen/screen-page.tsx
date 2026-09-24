import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RosterEntry } from '@mymozhem/sdk';
import { gameFinishedPayload, questionRevealedPayload, quizSettingsSchema } from '@mymozhem/app-quiz';
import { ApiClient } from '../../api/api-client';
import { ApiError } from '../../api/api-error';
import { joinRoom, listMembers, refreshSession } from '../../api/endpoints';
import { ConnectionBanner } from '../../components/connection-banner';
import { rosterNames } from '../../components/roster-names';
import { Standings } from '../../components/standings';
import { Winners } from '../../components/winners';
import { deriveRoomStatus, projectLottery, projectQuiz } from '../../state/projections';
import { shouldRefetchRoster } from '../../state/roster-refetch';
import { decodeAccessClaims, SessionStore } from '../../state/session';
import { useRoomBinding } from '../../state/use-room-binding';

// anonClient (ruling 1): join/refresh — auth:false, access-токена им не нужен,
// поэтому провайдер всегда отдаёт null. Тот же паттерн, что в play-page.
const anonClient = new ApiClient({
  getAccessToken: () => null,
  refresh: () => Promise.resolve(),
});

// UX-маппинг кодов join (дизайн §5) — как в play: код комнаты свёрнут сервером
// в JOIN_DENIED (REQ-ID-013), rate-limit просит подождать, неизвестный код —
// общий экран «обновите».
const joinErrorText = (e: unknown): string => {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'ROOM_JOIN_DENIED':
        return 'Не удалось подключить экран: проверьте код комнаты.';
      case 'ROOM_PARTICIPANT_LIMIT_REACHED':
        return 'Комната заполнена, свободных мест нет.';
      case 'RATE_LIMITED':
        return 'Слишком много попыток. Подождите немного и обновите страницу.';
      default:
        return `Не удалось подключить экран (${e.code}). Обновите страницу.`;
    }
  }
  return 'Ошибка сети. Проверьте соединение и обновите страницу.';
};

// Проектор (дизайн §4/§8): spectator-join по коду из URL, read-only — ни форм,
// ни кнопок, ни publish. Зритель смотрит: текущий вопрос крупно → табло после
// reveal → финал с итогами лотереи.
export function ScreenPage() {
  const { code } = useParams();
  // SessionStore здесь — только in-memory TokenProvider (ruling 2): saveGuest
  // НЕ вызывается, потому что play-страница хранит гостевую сессию под тем же
  // ключом localStorage, и spectator 'Экран' затёр бы её на этом устройстве.
  // Зритель без состояния: перезагрузка проектора = новый spectator-join по коду.
  const [session] = useState(
    () => new SessionStore(async () => (await refreshSession(anonClient)).accessToken),
  );
  // Авторизованный клиент поверх SessionStore — для listMembers (auth:true).
  const [client] = useState(() => new ApiClient(session));
  const [roomId, setRoomId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const joinStarted = useRef(false);

  // Автоматический spectator-join по коду из :code — единственный вход на экран.
  useEffect(() => {
    // StrictMode в dev дёргает effect дважды; повторный join создавал бы вторую
    // identity — страхуемся ref'ом, эффект одноразовый.
    if (joinStarted.current) return;
    joinStarted.current = true;
    if (!code) {
      setJoinError('В ссылке нет кода комнаты.');
      return;
    }
    void (async () => {
      try {
        // displayName фиксированный — экран не спрашивает имя; роль spectator.
        const res = await joinRoom(anonClient, { code, displayName: 'Экран', role: 'spectator' });
        session.setAccessToken(res.accessToken);
        // roomId — только из claims токена: идентичность из аутентифицированного
        // контекста, не из URL/payload (REQ-RT-009 по смыслу).
        const claims = decodeAccessClaims(res.accessToken);
        if (!claims.roomId) throw new Error('join token without roomId');
        setRoomId(claims.roomId);
      } catch (e) {
        setJoinError(joinErrorText(e));
      }
    })();
  }, [code, session]);

  const binding = useRoomBinding(roomId, session);
  const events = binding.events;

  const [members, setMembers] = useState<RosterEntry[]>([]);

  // Ростер (ruling 4): join не эмитит событий — первая загрузка на subscribe…
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

  // …и событийный рефетч там, где имена появляются на экране (табло/победители).
  useEffect(() => {
    const last = events[events.length - 1];
    if (!roomId || !last || !shouldRefetchRoster(last.type)) return;
    listMembers(client, roomId)
      .then((r) => setMembers(r.members))
      .catch(() => {});
  }, [events, roomId, client]);

  const names = useMemo(() => rosterNames(members), [members]);

  // recordedAt — момент приёма: wire его не несёт; влияет только на отображение,
  // баллы едут в payload question.revealed.
  const quiz = projectQuiz(events, new Date().toISOString());
  const lottery = projectLottery(events, new Date().toISOString());
  const status = deriveRoomStatus(events);
  const currentQuestion = quiz.currentQuestion;

  // Публичная проекция appSettings (REQ-CORE-008): correctAnswers сюда
  // структурно не доезжают, поэтому парсим только public-ключ questions.
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

  if (!roomId) {
    // До join баннер не рендерим (ruling 3): useRoomBinding(null) держит
    // 'connecting' навсегда — это отсутствие привязки, а не обрыв.
    return (
      <main>
        {joinError ? <p role="alert">{joinError}</p> : <p>Подключаем экран…</p>}
      </main>
    );
  }

  let view;
  if (quiz.finished || status === 'COMPLETED') {
    // Финал: итоговое табло (места из payload game.finished, если событие было)
    // + итоги лотереи (дизайн §4).
    const finishedEvent = [...events].reverse().find((e) => e.type === 'quiz.game.finished');
    const finalStandings = finishedEvent
      ? gameFinishedPayload.parse(finishedEvent.payload).standings
      : undefined;
    view = (
      <section>
        <h1>Игра завершена</h1>
        <Standings standings={finalStandings} totals={quiz.totals} names={names} />
        <Winners draws={lottery.draws} names={names} />
      </section>
    );
  } else if (status === 'CANCELLED') {
    view = <p>Комната отменена организатором.</p>;
  } else if (status !== 'ACTIVE') {
    view = <p>Ожидаем начала — организатор ещё готовит комнату…</p>;
  } else if (currentQuestion !== null && quiz.accepting) {
    // Текущий вопрос крупно (проектор): текст + варианты без кнопок — отвечают
    // участники со своих устройств, экран только показывает.
    const question = questions[currentQuestion];
    view = (
      <section>
        <h1 className="screen-question">
          {question ? question.text : `Вопрос ${currentQuestion + 1}`}
        </h1>
        <ul className="screen-options">
          {(question?.options ?? []).map((option, optionIndex) => (
            <li key={optionIndex}>{option}</li>
          ))}
        </ul>
      </section>
    );
  } else if (currentQuestion !== null && reveal) {
    // Reveal: правильный ответ (единственный публичный источник — payload
    // revealed; correctAnswers клиенту структурно недоступны) + табло.
    const correctOption =
      reveal.correctIndex !== undefined
        ? questions[currentQuestion]?.options[reveal.correctIndex]
        : undefined;
    view = (
      <section>
        {correctOption ? <h1 className="screen-question">Правильный ответ: {correctOption}</h1> : null}
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
      {view}
    </main>
  );
}
