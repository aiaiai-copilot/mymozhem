import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveHostGateTarget } from './host-gate-flow';
import { hostSession } from './host-session';

// Гейт организатора (ADR-012 §2): login по setup-токену кладёт access-токен в
// память и приводит сюда; прямой заход/перезагрузка /host — молчаливый refresh
// по куке. Маршрут решает resolveHostGateTarget: сессии нет или это гость — на
// лендинг; организатор — в консоль (комната уже создана) или в setup.
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
        const target = await resolveHostGateTarget(hostSession);
        navigate(target, { replace: true });
      } catch {
        navigate('/', { replace: true });
      }
    })();
  }, [navigate]);

  return <p>Входим…</p>;
}
