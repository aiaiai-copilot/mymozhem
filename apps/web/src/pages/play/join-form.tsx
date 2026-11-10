import { useState, type FormEvent } from 'react';
import { DISPLAY_NAME_MAX_LENGTH, type JoinRequest } from '@mymozhem/sdk';
import { ApiError } from '../../api/api-error';
import type { ApiClient } from '../../api/api-client';
import { joinRoom } from '../../api/endpoints';
import { Logo } from '../../components/logo';
import { decodeAccessClaims, SessionStore } from '../../state/session';

// Тело join (ADR-012 §3): имя необязательно — пустое уходит БЕЗ ключа
// displayName (пустая строка не прошла бы displayNameSchema.min(1)), сервер
// назначит псевдоним и вернёт фактическое имя в ответе.
export const buildJoinRequest = (code: string, trimmedName: string): JoinRequest =>
  trimmedName ? { code, displayName: trimmedName } : { code };

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
    // Имя не обязательно (ADR-012 §3) — пустое уходит без displayName, сервер
    // назначит псевдоним; обязателен только код комнаты.
    if (!trimmedCode) {
      setError('Введите код комнаты.');
      return;
    }
    setBusy(true);
    setError(null);
    void joinRoom(client, buildJoinRequest(trimmedCode, trimmedName))
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
        // Сохраняем ФАКТИЧЕСКОЕ имя из ответа — оно могло быть псевдонимом.
        SessionStore.saveGuest({ code: trimmedCode, displayName: res.displayName });
        onJoined(claims.roomId);
      })
      .catch((err: unknown) => setError(joinErrorText(err)))
      .finally(() => setBusy(false));
  };

  // Разметка — эталон participant-join-lobby-center-fix: логотип по центру,
  // «Входъ в игру» (Приложение A), золотые подписи полей, кнопка «Играть» —
  // сценический вариант (.btn-scene + .btn-join), не консольный .btn-primary.
  return (
    <>
      <Logo contour="scene" size="participant" />
      <h1 className="play-title">Входъ в игру</h1>
      <form onSubmit={submit}>
        {codeFromUrl ? (
          // Ссылка-приглашение: код показываем read-only полем (мокап входа),
          // вводить не просим.
          <label className="play-field">
            Код комнаты
            <input className="play-input" value={codeFromUrl} readOnly autoComplete="off" />
          </label>
        ) : (
          <label className="play-field">
            Код комнаты
            <input
              className="play-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </label>
        )}
        <label className="play-field">
          Ваше имя (необязательно)
          <input
            className="play-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            placeholder="Получите псевдоним, если пусто"
            autoComplete="off"
            disabled={busy}
          />
        </label>
        {error ? (
          <p role="alert" className="play-error">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-scene btn-join" disabled={busy}>
          {busy ? 'Входим…' : 'Играть'}
        </button>
      </form>
    </>
  );
}
