import type { ConnectionState } from '../realtime/room-connection';
import { reconnectBannerVisible } from '../state/use-room-binding';

// Явный индикатор обрыва (дизайн §5): reconnect самолечится перефолдом, но пока
// соединение не live, участник и ведущий обязаны видеть это, а не гадать.
// Баннер рендерится только при активной привязке к комнате (ruling: до join
// состояние 'connecting' — это отсутствие соединения, а не обрыв).
// При живой поверхности отказа стартового join (joinErrorSurface) баннер
// «переподключаемся» подавляется: после упавшего СТАРТОВОГО subscribe никто
// не переподключается — говорит alert (финревью батча C, Important 1/2).
export function ConnectionBanner({
  state,
  joinErrorSurface = null,
}: {
  state: ConnectionState;
  joinErrorSurface?: string | null;
}) {
  if (state === 'live') return null;
  if (state === 'disconnected' && !reconnectBannerVisible(state, joinErrorSurface)) return null;
  return (
    <p role="status">{state === 'connecting' ? 'Подключение…' : 'Нет соединения. Переподключаемся…'}</p>
  );
}
