import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { decodeAccessClaims, SessionStore } from '../../state/session';
import { hostSession } from './host-session';

// OAuth-гейт организатора (дизайн Task 13): /auth/google возвращает сюда с
// refresh-кукой. Молчаливый refresh решает маршрут: сессии нет или это гость —
// на лендинг; организатор — в консоль (комната уже создана) или в setup.
export function HostGate() {
  const navigate = useNavigate();
  // StrictMode в dev дёргает effect дважды; refresh-токен ротируется сервером,
  // и параллельный дубль может инвалидировать первый ответ — эффект одноразовый.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        await hostSession.refresh();
        const token = hostSession.getAccessToken();
        if (!token) throw new Error('refresh resolved without token');
        // Декод display-only, без верификации (session.ts): доступ всё равно
        // решит сервер; здесь лишь маршрутизация — гостю в /host делать нечего.
        const claims = decodeAccessClaims(token);
        if (claims.kind !== 'REGISTERED') {
          navigate('/', { replace: true });
          return;
        }
        // Одна комната на организатора (MVP): была — сразу в консоль.
        navigate(SessionStore.loadHostRoomId() ? '/host/console' : '/host/new', {
          replace: true,
        });
      } catch {
        navigate('/', { replace: true });
      }
    })();
  }, [navigate]);

  return <p>Входим…</p>;
}
