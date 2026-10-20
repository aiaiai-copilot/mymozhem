import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RosterEntry } from '@mymozhem/sdk';
import { questionRevealedPayload, quizSettingsSchema } from '@mymozhem/app-quiz';
import { ApiClient } from '../../api/api-client';
import { ApiError } from '../../api/api-error';
import { joinRoom, listMembers, refreshSession } from '../../api/endpoints';
import { ConnectionBanner } from '../../components/connection-banner';
import { Logo } from '../../components/logo';
import { RaceTracks } from '../../components/race-tracks';
import { displayNameOf, rosterNames } from '../../components/roster-names';
import { Winners } from '../../components/winners';
import { deriveRoomStatus, projectLottery, projectQuiz } from '../../state/projections';
import { isCompactQuestion } from '../../state/question-density';
import { formatTimer, useQuestionTimer } from '../../state/question-timer';
import { lastRoundGains } from '../../state/race-tracks';
import { shouldRefetchRoster } from '../../state/roster-refetch';
import { decodeAccessClaims, SessionStore } from '../../state/session';
import { useRoomBinding } from '../../state/use-room-binding';

// Буквенные метки вариантов (золотые <b>, мокап timer-projector-participant;
// тот же подход, что в play-page). Вариантов больше, чем букв, — без метки.
const OPTION_LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'];

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

// Проектор (дизайн §5.2, п. 8): spectator-join по коду из URL, read-only — ни
// форм, ни кнопок, ни publish. Зритель смотрит: текущий вопрос крупно с
// таймером → reveal с дорожками топ-4 → финал топ-5 с победителями лотереи.
// Логотип — левый верхний угол на всех экранах (п. 17), стили — screen.css.
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
  const joinInFlight = useRef(false);

  // Автоматический spectator-join по коду из :code — единственный вход на экран.
  // Гард сбрасывается в finally: перезаходу (onSessionDead, находка №5) нужен
  // повторный вход, а StrictMode-перекрытие по-прежнему отсекает параллельный
  // дубль (второй эффект видит in-flight join).
  const joinSpectator = useCallback(async () => {
    setJoinError(null);
    if (!code) {
      setJoinError('В ссылке нет кода комнаты.');
      return;
    }
    if (joinInFlight.current) return;
    joinInFlight.current = true;
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
    } finally {
      joinInFlight.current = false;
    }
  }, [code, session]);

  useEffect(() => {
    void joinSpectator();
  }, [joinSpectator]);

  const binding = useRoomBinding(roomId, session, {
    onSessionDead: useCallback(() => {
      // См. play-page: отвязка → перезаход следующим тиком (rebind при том же
      // roomId). Перезаход spectator = новый spectator 'Экран'; saveGuest не
      // трогаем — зритель не затирает guest-сессию play-страницы.
      setRoomId(null);
      setTimeout(() => void joinSpectator(), 0);
    }, [joinSpectator]),
  });
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

  // Таймер вопроса (п. 12): durationSec — только из распарсенных настроек
  // (дефолт 30 материализуется на parse; без raw appSettings и без «?? 30»),
  // openedAt — серверный штамп из проекции. «Без лимита» → null → таймер не
  // рендерится вообще. Хук вызван до ранних return (rules of hooks).
  const question = currentQuestion !== null ? questions[currentQuestion] : undefined;
  const durationSec = question?.durationSec ?? null;
  const timerSec = useQuestionTimer(durationSec, quiz.openedAt);

  // Табло дорожками (дизайн §7): итоги из проекции, прирост — из последнего
  // reveal в логе (lastRoundGains), имена — через displayNameOf (fallback
  // «Гость» внутри). Сортировка/нормировка — внутри RaceTracks.
  const gains = lastRoundGains(events);
  const trackEntries = Object.entries(quiz.totals).map(([actorId, total]) => ({
    actorId,
    name: displayNameOf(names, actorId),
    total,
    gain: gains[actorId] ?? 0,
  }));

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
      <main className="screen-page">
        <Logo contour="scene" size="projector" />
        {joinError ? (
          <p role="alert" className="screen-waiting">
            {joinError}
          </p>
        ) : (
          <p className="screen-waiting">Подключаем экран…</p>
        )}
      </main>
    );
  }

  let view;
  if (quiz.finished || status === 'COMPLETED') {
    // Финал (§5.2, п. 8/13/18): табло топ-5 дорожками + «ещё N» (строка — как
    // рендерит RaceTracks, не переопределяем); победители — центрированный
    // блок в свободной правой зоне. Без розыгрыша блок не рендерится, табло
    // центрируется на всю зону (класс solo). Места из payload game.finished
    // не нужны: дорожки сами сортируют desc (как финал участника, T7).
    const hasDraws = Object.keys(lottery.draws).length > 0;
    view = (
      <section>
        <h1 className="screen-final-title">Игра завершена</h1>
        <div className={hasDraws ? 'screen-final-grid' : 'screen-final-grid screen-final-solo'}>
          <div>
            <div className="screen-board-title">Итоговое табло</div>
            <RaceTracks entries={trackEntries} contour="scene" topN={5} />
          </div>
          {hasDraws ? (
            <div className="screen-winners">
              <Winners draws={lottery.draws} names={names} />
            </div>
          ) : null}
        </div>
      </section>
    );
  } else if (status === 'CANCELLED') {
    view = <p className="screen-waiting">Комната отменена организатором.</p>;
  } else if (status !== 'ACTIVE') {
    // Ожидание (п. 8): центрировано во всём кадре, логотип не влияет.
    view = <p className="screen-waiting">Ожидаем начала — организатор ещё готовит комнату…</p>;
  } else if (currentQuestion !== null && quiz.accepting) {
    // Вопрос (§5.2, п. 8/12): верхняя строка — «Вопросъ N из M» (Приложение A)
    // + таймер 56px золотом справа (только при включённом лимите); отступ
    // перед вариантами 35px; варианты — две колонки без золотых линий;
    // длинный вопрос / более четырёх вариантов — компактная плотность
    // (мокап projector-options-no-lines). Отвечают участники со своих
    // устройств — экран только показывает.
    const compact = isCompactQuestion(question?.text.length ?? 0, question?.options.length ?? 0);
    view = (
      <section>
        <div className="screen-strip">
          <span className="screen-kicker">
            {question
              ? `Вопросъ ${currentQuestion + 1} из ${questions.length}`
              : `Вопросъ ${currentQuestion + 1}`}
          </span>
          {timerSec !== null ? (
            <span className="screen-timer">
              {formatTimer(timerSec)}
              <small>осталось</small>
            </span>
          ) : null}
        </div>
        <h1 className={compact ? 'screen-question screen-question-compact' : 'screen-question'}>
          {question ? question.text : `Вопросъ ${currentQuestion + 1}`}
        </h1>
        <ul className={compact ? 'screen-options screen-options-compact' : 'screen-options'}>
          {(question?.options ?? []).map((option, optionIndex) => {
            const letter = OPTION_LETTERS[optionIndex];
            return (
              <li key={optionIndex}>
                {letter ? <b>{letter}</b> : null}
                {option}
              </li>
            );
          })}
        </ul>
      </section>
    );
  } else if (currentQuestion !== null && reveal) {
    // Reveal (§5.2, мокап tracks-scene-with-logo): «Правильный отвѣтъ»
    // (Приложение A) слева, табло дорожками справа — топ-4 + «ещё N».
    // Правильный ответ — только из payload revealed: correctAnswers клиенту
    // структурно недоступны.
    const correctOption =
      reveal.correctIndex !== undefined
        ? questions[currentQuestion]?.options[reveal.correctIndex]
        : undefined;
    view = (
      <section className="screen-reveal">
        <div className="screen-answer">
          {correctOption ? (
            <>
              <div className="screen-answer-label">Правильный отвѣтъ</div>
              <h1 className="screen-answer-value">{correctOption}</h1>
            </>
          ) : null}
        </div>
        <div>
          <div className="screen-board-title">Табло</div>
          <RaceTracks entries={trackEntries} contour="scene" topN={4} />
        </div>
      </section>
    );
  } else if (currentQuestion !== null) {
    view = <p className="screen-waiting">Ответы закрыты, ждём результатов…</p>;
  } else {
    // ACTIVE без открытого вопроса: ждём первый вопрос; в лотерейной комнате
    // здесь же появляются победители по мере розыгрышей.
    view = (
      <section>
        <p className="screen-note">Игра идёт. Ждём вопрос…</p>
        {Object.keys(lottery.draws).length > 0 ? (
          <div className="screen-winners">
            <Winners draws={lottery.draws} names={names} />
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <main className="screen-page">
      <ConnectionBanner state={binding.connectionState} />
      <Logo contour="scene" size="projector" />
      {view}
    </main>
  );
}
