import { useState, type FormEvent } from 'react';
import { DISPLAY_NAME_MAX_LENGTH } from '@mymozhem/sdk';
import { ApiError } from '../../api/api-error';
import type { ApiClient } from '../../api/api-client';
import { joinRoom } from '../../api/endpoints';
import { decodeAccessClaims, SessionStore } from '../../state/session';

interface JoinFormProps {
  // Код из URL (:code): ссылка-приглашение — код показываем read-only, вводить
  // не просим. Без кода в URL — обычное поле ввода.
  codeFromUrl?: string;
  initialDisplayName?: string;
  // anon-клиент: join — auth:false, access-токена ещё нет.
  client: ApiClient;
  session: SessionStore;
  onJoined: (roomId: string) => void;
  // Ошибка авто-входа (протухшая сохранённая сессия) — показываем над формой.
  initialError?: string | null;
}

// UX-маппинг серверных кодов (дизайн §5); неизвестный код — честный текст кода.
const joinErrorText = (e: unknown): string => {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'ROOM_JOIN_DENIED':
        return 'Не удалось войти: проверьте код комнаты.';
      case 'ROOM_PARTICIPANT_LIMIT_REACHED':
        return 'Комната заполнена, свободных мест нет.';
      case 'RATE_LIMITED':
        return 'Слишком много попыток. Подождите немного.';
      default:
        return `Ошибка входа (${e.code}). Попробуйте ещё раз.`;
    }
  }
  return 'Ошибка сети. Проверьте соединение и попробуйте ещё раз.';
};

export function JoinForm({
  codeFromUrl,
  initialDisplayName,
  client,
  session,
  onJoined,
  initialError,
}: JoinFormProps) {
  const [code, setCode] = useState(codeFromUrl ?? '');
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedCode = code.trim();
    const trimmedName = displayName.trim();
    if (!trimmedCode || !trimmedName) {
      setError('Введите код комнаты и имя.');
      return;
    }
    setBusy(true);
    setError(null);
    void joinRoom(client, { code: trimmedCode, displayName: trimmedName })
      .then((res) => {
        session.setAccessToken(res.accessToken);
        // roomId — только из claims токена (REQ-RT-009 по смыслу: идентичность —
        // из аутентифицированного контекста, не из payload/URL).
        const claims = decodeAccessClaims(res.accessToken);
        if (!claims.roomId) {
          setError('Ответ сервера без комнаты. Попробуйте ещё раз.');
          return;
        }
        // Переживающая перезагрузку идентификация (дизайн §5): код+имя, не токен.
        SessionStore.saveGuest({ code: trimmedCode, displayName: trimmedName });
        onJoined(claims.roomId);
      })
      .catch((err: unknown) => setError(joinErrorText(err)))
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit}>
      <h1>Вход в игру</h1>
      {codeFromUrl ? (
        <p>
          Код комнаты: <strong>{codeFromUrl}</strong>
        </p>
      ) : (
        <label>
          Код комнаты
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </label>
      )}
      <label>
        Ваше имя
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          autoComplete="off"
          disabled={busy}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={busy}>
        {busy ? 'Входим…' : 'Играть'}
      </button>
    </form>
  );
}
