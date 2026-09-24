import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/api-error';
import { ConnectionBanner } from '../../components/connection-banner';
import { SessionStore } from '../../state/session';
import { useRoomBinding } from '../../state/use-room-binding';
import { useRoomFeed } from '../../state/use-room-feed';
import { hostClient, hostSession } from './host-session';
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

  // Прямой заход на /host/console без комнаты/токена — на гейт: он сделает
  // refresh и сам разведёт на console или setup.
  useEffect(() => {
    if (!roomId || !hostSession.getAccessToken()) navigate('/host', { replace: true });
  }, [roomId, navigate]);

  const binding = useRoomBinding(roomId, hostSession);
  const feed = useRoomFeed(roomId, hostClient, binding.events);

  const runCommand = (type: string, payload: Record<string, unknown>) => {
    setCommandError(null);
    void binding
      .publish(type, payload)
      .catch((e: unknown) => setCommandError(commandErrorText(e)));
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
      <QuizControls
        events={binding.events}
        quiz={feed.quiz}
        names={feed.names}
        onCommand={runCommand}
        commandError={commandError}
      />
    </main>
  );
}
