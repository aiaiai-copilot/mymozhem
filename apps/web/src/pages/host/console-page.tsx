import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CORE_EVENTS, coreEventType } from '@mymozhem/sdk';
import type { AwardResponse, RosterEntry } from '@mymozhem/sdk';
import { gameFinishedPayload, QUIZ_APP_ID } from '@mymozhem/app-quiz';
import { ApiError } from '../../api/api-error';
import { completeRoom, listRewards } from '../../api/endpoints';
import { FocusDim } from '../../components/focus-dim';
import { Logo } from '../../components/logo';
import { RaceTracks } from '../../components/race-tracks';
import { displayNameOf } from '../../components/roster-names';
import { Winners } from '../../components/winners';
import { HOST_NEW_PATH } from '../../routes';
import { SessionStore } from '../../state/session';
import { pluralRu } from '../../state/plural-ru';
import { useFocusDim } from '../../state/use-focus-dim';
import { useRoomBinding } from '../../state/use-room-binding';
import { useRoomFeed } from '../../state/use-room-feed';
import { AwardsPanel } from './awards-panel';
import { hostClient, hostSession } from './host-session';
import { MembersPanel } from './members-panel';
import { PrizesPanel } from './prizes-panel';
import { QuizControls } from './quiz-controls';

// UX-маппинг ошибок publish-команд — тот же стиль, что answerErrorText в
// play-page: известных человеческих формулировок у команд ведущего нет,
// поэтому честный код (REQ-SEC-006: коды безопасны для показа). Отказы
// транспорта (NOT_CONNECTED/PUBLISH_TIMEOUT, T1) — честная формулировка
// решения 7: ack-таймаут не значит «не исполнилось», повтор руками безопасен
// (сервер отвечает конфликтом состояния, состояние сходится через realtime).
export const commandErrorText = (e: unknown): string => {
  if (e instanceof ApiError) {
    if (e.code === 'NOT_CONNECTED' || e.code === 'PUBLISH_TIMEOUT') {
      return 'Нет подтверждения команды — проверьте, не применилась ли она, прежде чем повторять.';
    }
    return `Команда не выполнена (${e.code}).`;
  }
  return 'Ошибка сети. Команда не выполнена.';
};

// Поверхность отказа стартовой подписки (carry финревью батча A): после T1
// join может отказать ApiError('SUBSCRIBE_TIMEOUT') — подписка сама не
// восстанавливается (join не идемпотентен, use-room-binding), поэтому честный
// текст с явным советом, а не только общий баннер «переподключаемся».
// Стейл-коды (isStaleRoomJoinError) сюда не доезжают — у них свой экран.
export const joinErrorText = (code: string | null): string | null =>
  code === 'SUBSCRIBE_TIMEOUT'
    ? 'Комната не подтвердила подключение — проверьте связь и обновите страницу.'
    : null;

// Стейл-roomId (находка №3): сохранённая комната из прошлой БД — join отказывает
// ACTOR_NOT_MEMBER; это «комнаты нет», а не «нет соединения».
export const isStaleRoomJoinError = (code: string | null): boolean =>
  code === 'ACTOR_NOT_MEMBER' || code === 'NOT_FOUND';

// Знаменатель разбора «не успели» и «N из M ответили» (бриф T9): играют
// только participant — организатор и наблюдатели в счётчик не входят.
export const participantsCount = (members: RosterEntry[]): number =>
  members.filter((m) => m.role === 'participant').length;

// Невручённые награды — статус AWARDED (FULFILLED/REVOKED терминальны,
// REQ-RWD-007). Подсказка экрана «Квиз окончен» — только при них (п. 18).
export const pendingAwardsCount = (awards: AwardResponse[]): number =>
  awards.filter((a) => a.status === 'AWARDED').length;

// Консоль ведущего (бриф T9, дизайн §5.3): каркас «пульт ведущего» —
// полоса комнаты (логотип, связь, код) → hero текущего момента с главной
// кнопкой (QuizControls) → секции (приглашения, панели) → тихая
// «Завершить событие» внизу. Переиспользует hostSession/hostClient
// Task 13 — второй SessionStore на host-флоу не заводим.
export function ConsolePage() {
  const navigate = useNavigate();
  // roomId/code — из localStorage, меняться за жизнь страницы не могут.
  const [roomId] = useState<string | null>(() => SessionStore.loadHostRoomId());
  const [roomCode] = useState<string | null>(() => SessionStore.loadHostRoomCode());
  const [commandError, setCommandError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  // Busy publish-команд (находка Н1, решение 3): одна команда в полёте —
  // второй клик невозможен конструкцией (кнопки QuizControls disabled); settle
  // гарантирован ack-таймаутом T1, finally всегда отпускает.
  const [commandPending, setCommandPending] = useState(false);
  // Награды целиком (null — не загружены/ошибка): из них derive подсказка
  // «Квиз окончен» (только факт невручённых, п. 18) и гейт секции наград на
  // COMPLETED (без наград — без блока вообще, п. 18).
  const [awards, setAwards] = useState<AwardResponse[] | null>(null);
  // «ещё N — развернуть» итогового табло COMPLETED (I-5, образец — toggle
  // промежуточного табло в quiz-controls).
  const [completedExpanded, setCompletedExpanded] = useState(false);

  // Прямой заход на /host/console без комнаты/токена — на гейт: он сделает
  // refresh и сам разведёт на console или setup.
  useEffect(() => {
    if (!roomId || !hostSession.getAccessToken()) navigate('/host', { replace: true });
  }, [roomId, navigate]);

  const binding = useRoomBinding(roomId, hostSession);
  const feed = useRoomFeed(roomId, hostClient, binding.events);
  // Затемнение нефокусного окна (находка Н1, решение 1; контуры — решение 2:
  // play + console, проектор без вуали). Хук до ранних return — хуки безусловны.
  const dimmed = useFocusDim();

  const [roomGone, setRoomGone] = useState(false);

  // Однократно на переход joinError: ключи снимаем атомарно (clearHostRoom),
  // иначе следующий заход на /host снова приведёт в мёртвую комнату.
  useEffect(() => {
    if (isStaleRoomJoinError(binding.joinError)) {
      SessionStore.clearHostRoom();
      setRoomGone(true);
    }
  }, [binding.joinError]);

  // Пин приложения — из payload core.room.activated (REQ-RT-004: ACTIVE
  // замораживает пару appId/manifestVersion). Парсим той же схемой, что ядро
  // коммитит, — не слепым cast. Последний activated побеждает, как в
  // deriveRoomStatus (переактивация невозможна, но fold-правило едино).
  // useMemo до любых early return — хуки безусловны (гейта react-hooks нет).
  const pinnedAppId = useMemo(() => {
    let appId: string | null = null;
    for (const e of binding.events) {
      if (e.type === coreEventType('room.activated')) {
        appId = CORE_EVENTS['room.activated'].schema.parse(e.payload).appId;
      }
    }
    return appId;
  }, [binding.events]);

  // Терминальный статус: deriveRoomStatus уже отразил completed/cancelled из
  // лога; панели в терминале глушим (сервер и так отказал бы, но зря не даём).
  const terminal = feed.status === 'COMPLETED' || feed.status === 'CANCELLED';

  // Экран «Квиз окончен» живёт при quiz.finished && ACTIVE (бриф T9 Step 5).
  const quizFinishedLive = feed.quiz.finished && feed.status === 'ACTIVE';

  // Текстовая поверхность отказа стартовой подписки (carry финревью батча A):
  // SUBSCRIBE_TIMEOUT → честный текст с советом; null — поверхности нет.
  const joinErrorSurface = joinErrorText(binding.joinError);

  // Рефетч-триггер наград: публичные rewards.* (awarded/fulfilled/revoked —
  // REQ-SEC-009, payload только id). Счётчик событий, а не последнее событие:
  // переход quizFinishedLive с quiz.game.finished последним тоже должен
  // загрузить список.
  const rewardsEventCount = useMemo(
    () => binding.events.filter((e) => e.type.startsWith('rewards.')).length,
    [binding.events],
  );

  // Награды грузим на экране «Квиз окончен» (подсказка) и на COMPLETED
  // (подзаголовок hero + гейт секции наград) — тем же путём, что AwardsPanel
  // (listRewards). Best effort: ошибка → null → подсказки/секции нет, кнопка
  // «Завершить событие» не блокируется невручёнными наградами (REQ-RWD-009).
  const awardsNeeded = quizFinishedLive || feed.status === 'COMPLETED';
  useEffect(() => {
    if (!roomId || !awardsNeeded) return;
    let stale = false;
    listRewards(hostClient, roomId)
      .then((r) => {
        if (!stale) setAwards(r.awards);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [roomId, awardsNeeded, rewardsEventCount]);

  // Невручённые награды — статус AWARDED (подсказка п. 18); null, пока список
  // не загружен, — подсказки нет.
  const pendingAwards = awards === null ? null : pendingAwardsCount(awards);

  // Итоговое табло COMPLETED — та же сборка, что финал QuizControls: места из
  // payload game.finished (их посчитал модуль), fallback — totals проекции.
  // Прирост — атрибут reveal-момента, на финале дорожки без золотой дельты
  // (та же норма, что у экрана «Квиз окончен»).
  const completedStandings = useMemo(() => {
    const finishedEvent = [...binding.events]
      .reverse()
      .find((e) => e.type === 'quiz.game.finished');
    return finishedEvent ? gameFinishedPayload.parse(finishedEvent.payload).standings : undefined;
  }, [binding.events]);
  const completedEntries = useMemo(() => {
    const rows =
      completedStandings ??
      Object.entries(feed.quiz.totals).map(([actorId, total]) => ({ actorId, total }));
    return rows.map((r) => ({
      actorId: r.actorId,
      name: displayNameOf(feed.names, r.actorId),
      total: r.total,
      gain: 0,
    }));
  }, [completedStandings, feed.quiz.totals, feed.names]);

  const runCommand = (type: string, payload: Record<string, unknown>) => {
    if (commandPending) return;
    setCommandPending(true);
    setCommandError(null);
    void binding
      .publish(type, payload)
      .catch((e: unknown) => setCommandError(commandErrorText(e)))
      .finally(() => setCommandPending(false));
  };

  // «Завершить событие» (бриф Task 15): confirm() — переход терминален и
  // необратим (REQ-RT-005), случайный клик не должен гасить событие. Статус
  // COMPLETED приедет core.room.completed в лог — deriveRoomStatus поднимет его
  // сам, локальный статус не выставляем.
  const completeEvent = () => {
    if (!roomId || terminal || completing) return;
    if (!window.confirm('Завершить событие? Это действие необратимо.')) return;
    setCompleting(true);
    setCommandError(null);
    void completeRoom(hostClient, roomId)
      .catch((e: unknown) => setCommandError(commandErrorText(e)))
      .finally(() => setCompleting(false));
  };

  const copyLink = (key: string, path: string) => {
    // clipboard недоступен вне secure-context (http на чужой машине): тогда
    // просто не подтверждаем — текст ссылки остаётся виден рядом с кнопкой.
    void navigator.clipboard
      ?.writeText(`${window.location.origin}${path}`)
      .then(() => setCopied(key))
      .catch(() => {});
  };

  // «Вернуться к началу — новое событие» (мокап console-draw-winner-larger,
  // finish-состояние): ключи завершённой комнаты снимаем атомарно, иначе
  // следующий заход на /host воскресит её из localStorage.
  const backToStart = () => {
    SessionStore.clearHostRoom();
    navigate(HOST_NEW_PATH);
  };

  // Все хуки выше; дальше — только рендер-ветки.
  if (!roomId) {
    return (
      <main className="console-page">
        <p className="console-note">Переход…</p>
      </main>
    );
  }

  // «Комната не найдена» — карточка по мокапу console-empty-long-errors-v2.
  if (roomGone) {
    return (
      <main className="console-page">
        <div className="console-lost">
          <div className="console-lost-title">Комната не найдена</div>
          <p className="console-lost-sub">
            Сохранённая комната больше не существует (стенд был пересоздан). Создайте новую.
          </p>
          <a className="btn btn-primary console-lost-btn" href={HOST_NEW_PATH}>
            К настройке комнаты
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="console-page">
      {dimmed ? <FocusDim /> : null}
      {/* Полоса комнаты (мокап console-phone-landscape-v2): логотип, связь,
          код. Sticky — статус виден при прокрутке секций. */}
      <header className="console-strip">
        <Logo contour="console" size="compact" />
        <span
          className={`console-conn${binding.connectionState === 'live' ? '' : ' off'}`}
          role="status"
        >
          <span className="console-conn-dot" />
          {binding.connectionState === 'live'
            ? 'на связи'
            : binding.connectionState === 'connecting'
              ? 'подключение…'
              : 'нет связи'}
        </span>
        {roomCode ? <span className="console-room-code">{roomCode}</span> : null}
      </header>
      {/* Баннер обрыва — по мокапу console-empty-long-errors-v2; reconnect
          самолечится перефолдом, но ведущий обязан видеть обрыв явно. */}
      {binding.connectionState === 'disconnected' ? (
        <p role="status" className="console-error-banner">
          Нет соединения — переподключаемся…
          <span className="console-error-sub">
            Таймер и счётчики могут отставать. Ничего нажимать не нужно.
          </span>
        </p>
      ) : null}
      {joinErrorSurface ? (
        <p role="alert" className="console-error">
          {joinErrorSurface}
        </p>
      ) : null}
      {feed.status === 'CANCELLED' ? <p className="console-note">Комната отменена.</p> : null}
      {feed.status === 'COMPLETED' ? (
        /* Экран завершения (бриф T11, дизайн §5.3 «Завершение», п. 18; мокап
           console-draw-winner-larger finish-состояние): hero → невручённые
           награды первой секцией → итоговый забег → тихая «новое событие».
           Пульта квиза и панелей приглашений/участников/призов здесь нет. */
        <>
          <section className="console-hero console-completed-hero">
            <div className="console-moment">
              <div className="console-fh-title">Событие завершено</div>
              <p className="console-fh-sub">
                {pinnedAppId === QUIZ_APP_ID ? 'Квиз окончен · ' : ''}
                {pluralRu(participantsCount(feed.members), 'участник', 'участника', 'участников')}:{' '}
                {participantsCount(feed.members)}
                {pendingAwards !== null && pendingAwards > 0 ? ' · вручите награды' : ''}
              </p>
            </div>
          </section>
          <div className="console-sections">
            {/* Награды первыми — это то, что осталось сделать в зале; без
                наград — без блока вообще (п. 18). fulfill/revoke легальны при
                COMPLETED (REQ-RWD-009) — панель сознательно не гейтится
                статусом комнаты. */}
            {awards !== null && awards.length > 0 ? (
              <AwardsPanel roomId={roomId} names={feed.names} events={binding.events} />
            ) : null}
            <section className="console-card">
              <h3 className="console-card-title">Итоговое табло</h3>
              {completedEntries.length > 0 ? (
                <div className="console-tracks">
                  <RaceTracks
                    entries={completedEntries}
                    contour="console"
                    topN={completedExpanded ? undefined : 4}
                  />
                  {completedEntries.length > 4 ? (
                    <button
                      type="button"
                      className="console-tracks-toggle"
                      onClick={() => setCompletedExpanded((v) => !v)}
                    >
                      {completedExpanded
                        ? 'Свернуть'
                        : `ещё ${completedEntries.length - 4} ${pluralRu(completedEntries.length - 4, 'участник', 'участника', 'участников')} — развернуть`}
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="console-muted">Очков пока нет.</p>
              )}
            </section>
          </div>
          <button type="button" className="btn btn-quiet console-finish" onClick={backToStart}>
            Вернуться к началу — новое событие
          </button>
        </>
      ) : (
        <>
      {/* Пульт квиза — только в quiz-комнате: в lottery-комнате его команды
          гарантированно отклонит модуль (pin из room.activated, та же
          дисциплина, что у кнопки «Разыграть» в PrizesPanel). */}
      {pinnedAppId === QUIZ_APP_ID ? (
        <QuizControls
          events={binding.events}
          quiz={feed.quiz}
          names={feed.names}
          appSettings={binding.appSettings}
          disabled={terminal}
          participants={participantsCount(feed.members)}
          pendingAwards={pendingAwards}
          completing={completing}
          commandPending={commandPending}
          onCompleteEvent={completeEvent}
          onCommand={runCommand}
          commandError={commandError}
        />
      ) : null}
      <div className="console-sections">
        {roomCode ? (
          <section className="console-card">
            <h3 className="console-card-title">Приглашения</h3>
            {/* Не router-Link: one-shot join в play/screen не перезапускается на
                смену :code внутри SPA — ссылки именно для копирования наружу. */}
            <div className="console-link-row">
              Игроки: <code>{`${window.location.origin}/play/${roomCode}`}</code>{' '}
              <button
                type="button"
                className="btn btn-secondary console-copy"
                onClick={() => copyLink('play', `/play/${roomCode}`)}
              >
                Копировать
              </button>
            </div>
            <div className="console-link-row">
              Экран: <code>{`${window.location.origin}/screen/${roomCode}`}</code>{' '}
              <button
                type="button"
                className="btn btn-secondary console-copy"
                onClick={() => copyLink('screen', `/screen/${roomCode}`)}
              >
                Копировать
              </button>
            </div>
            {copied ? (
              <p role="status" className="console-muted">
                Скопировано.
              </p>
            ) : null}
          </section>
        ) : null}
        <MembersPanel
          roomId={roomId}
          members={feed.members}
          names={feed.names}
          disabled={terminal}
          onChanged={feed.refetchMembers}
        />
        <PrizesPanel
          roomId={roomId}
          pinnedAppId={pinnedAppId}
          disabled={terminal}
          events={binding.events}
          names={feed.names}
          publish={binding.publish}
        />
        {/* Результат розыгрыша приезжает публичным draw.completed — та же
            проекция, что на /screen; консоль только триггерит draw.run.
            Баннер в карточке призов показывает последнего победителя, Winners —
            полный список (бриф T11). */}
        <Winners
          draws={feed.lottery.draws}
          names={feed.names}
          className="console-card console-winners"
        />
        <AwardsPanel roomId={roomId} names={feed.names} events={binding.events} />
      </div>
      {/* Тихая «Завершить событие» внизу (бриф T9, дизайн п. 10). На экране
          «Квиз окончен» её роль играет главная кнопка hero — дубль не нужен.
          Не блокируется невручёнными наградами (REQ-RWD-009). */}
      {feed.status === 'ACTIVE' && !feed.quiz.finished ? (
        <button
          type="button"
          className="btn btn-quiet console-finish"
          disabled={completing}
          onClick={completeEvent}
        >
          {completing ? 'Завершаем…' : 'Завершить событие'}
        </button>
      ) : null}
        </>
      )}
    </main>
  );
}
