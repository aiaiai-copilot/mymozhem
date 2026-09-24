import type { ConnectionState } from '../realtime/room-connection';

// Явный индикатор обрыва (дизайн §5): reconnect самолечится перефолдом, но пока
// соединение не live, участник и ведущий обязаны видеть это, а не гадать.
// Баннер рендерится только при активной привязке к комнате (ruling: до join
// состояние 'connecting' — это отсутствие соединения, а не обрыв).
export function ConnectionBanner({ state }: { state: ConnectionState }) {
  if (state === 'live') return null;
  return (
    <p role="status">{state === 'connecting' ? 'Подключение…' : 'Нет соединения. Переподключаемся…'}</p>
  );
}
