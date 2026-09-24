import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CORE_EVENTS, coreEventType } from '@mymozhem/sdk';
import { QUIZ_APP_ID } from '@mymozhem/app-quiz';
import { ApiError } from '../../api/api-error';
import { completeRoom } from '../../api/endpoints';
import { ConnectionBanner } from '../../components/connection-banner';
import { Winners } from '../../components/winners';
import { SessionStore } from '../../state/session';
import { useRoomBinding } from '../../state/use-room-binding';
import { useRoomFeed } from '../../state/use-room-feed';
import { AwardsPanel } from './awards-panel';
import { hostClient, hostSession } from './host-session';
import { MembersPanel } from './members-panel';
import { PrizesPanel } from './prizes-panel';
import { QuizControls } from './quiz-controls';

// UX-маппинг ошибок publish-команд — тот же стиль, что answerErrorText в
// play-page: известных человеческих формулировок у команд ведущего нет,
// поэтому честный код (REQ-SEC-006: коды безопасны для показа).
const commandErrorText = (e: unknown): string => {
  if (e instanceof ApiError) return `Команда не выполнена (${e.code}).`;
  return 'Ошибка сети. Команда не выполнена.';
};

// Консоль ведущего (бриф Task 14): код комнаты крупно + копируемые ссылки,
// баннер соединения, пульт квиза по проекции лога. Переиспользует hostSession/
// hostClient Task 13 — второй SessionStore на host-флоу не заводим.
export function ConsolePage() {
  const navigate = useNavigate();
  // roomId/code — из localStorage, меняться за жизнь страницы не могут.
  const [roomId] = useState<string | null>(() => SessionStore.loadHostRoomId());
  const [roomCode] = useState<string | null>(() => SessionStore.loadHostRoomCode());
  const [commandError, setCommandError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  // Прямой заход на /host/console без комнаты/токена — на гейт: он сделает
  // refresh и сам разведёт на console или setup.
  useEffect(() => {
    if (!roomId || !hostSession.getAccessToken()) navigate('/host', { replace: true });
  }, [roomId, navigate]);

  const binding = useRoomBinding(roomId, hostSession);
  const feed = useRoomFeed(roomId, hostClient, binding.events);

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

  const runCommand = (type: string, payload: Record<string, unknown>) => {
    setCommandError(null);
    void binding
      .publish(type, payload)
      .catch((e: unknown) => setCommandError(commandErrorText(e)));
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

  // Все хуки выше; дальше — только рендер-ветки.
  if (!roomId) {
    return (
      <main>
        <p>Переход…</p>
      </main>
    );
  }

  return (
    <main>
      <ConnectionBanner state={binding.connectionState} />
      <h1>Консоль ведущего</h1>
      {roomCode ? (
        <section>
          {/* Не router-Link: one-shot join в play/screen не перезапускается на
              смену :code внутри SPA — ссылки именно для копирования наружу. */}
          <p className="room-code">
            Код комнаты: <strong>{roomCode}</strong>
          </p>
          <ul>
            <li>
              Игроки: <code>{`${window.location.origin}/play/${roomCode}`}</code>{' '}
              <button type="button" onClick={() => copyLink('play', `/play/${roomCode}`)}>
                Копировать
              </button>
            </li>
            <li>
              Экран: <code>{`${window.location.origin}/screen/${roomCode}`}</code>{' '}
              <button type="button" onClick={() => copyLink('screen', `/screen/${roomCode}`)}>
                Копировать
              </button>
            </li>
          </ul>
          {copied ? <p role="status">Скопировано.</p> : null}
        </section>
      ) : null}
      {feed.status === 'CANCELLED' ? <p>Комната отменена.</p> : null}
      {feed.status === 'COMPLETED' ? <p>Событие завершено.</p> : null}
      {feed.status === 'ACTIVE' ? (
        <p>
          <button type="button" disabled={completing} onClick={completeEvent}>
            Завершить событие
          </button>
        </p>
      ) : null}
      {/* Пульт квиза — только в quiz-комнате: в lottery-комнате его команды
          гарантированно отклонит модуль (pin из room.activated, та же
          дисциплина, что у кнопки «Разыграть» в PrizesPanel). */}
      {pinnedAppId === QUIZ_APP_ID ? (
        <QuizControls
          events={binding.events}
          quiz={feed.quiz}
          names={feed.names}
          onCommand={runCommand}
          commandError={commandError}
        />
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
        publish={binding.publish}
      />
      {/* Результат розыгрыша приезжает публичным draw.completed — та же
          проекция, что на /screen; консоль только триггерит draw.run. */}
      <Winners draws={feed.lottery.draws} names={feed.names} />
      <AwardsPanel roomId={roomId} names={feed.names} events={binding.events} />
    </main>
  );
}
