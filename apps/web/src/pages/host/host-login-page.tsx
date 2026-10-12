import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/api-error';
import { bootstrapOrganizer } from '../../api/endpoints';
import { anonClient, hostSession } from './host-session';

// ADR-012 §2: вход организатора — setup-токен из конфигурации инстанса
// (self-hosted норма). Токен НЕ персистится: живёт только в state формы;
// после протухания refresh-сессии вводится заново.
export function HostLoginPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    void bootstrapOrganizer(anonClient, { setupToken: token })
      .then((res) => {
        hostSession.setAccessToken(res.accessToken);
        navigate('/host');
      })
      .catch((err: unknown) =>
        setError(
          err instanceof ApiError && err.code === 'ORGANIZER_SETUP_INVALID'
            ? 'Неверный токен организатора.'
            : 'Не удалось войти. Попробуйте ещё раз.',
        ),
      )
      .finally(() => setBusy(false));
  };
  return (
    <main>
      <h1>Вход организатора</h1>
      <form onSubmit={submit}>
        <label>
          Токен организатора
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy || !token}>
          Войти
        </button>
      </form>
    </main>
  );
}
