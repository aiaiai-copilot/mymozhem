import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QUIZ_APP_ID, QUIZ_MANIFEST_VERSION, type QuizSettings } from '@mymozhem/app-quiz';
import {
  LOTTERY_APP_ID,
  LOTTERY_MANIFEST_VERSION,
  lotterySettingsSchema,
} from '@mymozhem/app-lottery';
import { ApiError } from '../../api/api-error';
import { activateRoom, configureRoom, createRoom } from '../../api/endpoints';
import { HOST_CONSOLE_PATH } from '../../routes';
import { SessionStore } from '../../state/session';
import { useSessionWakeRefresh } from '../../state/wake-refresh';
import { hostClient, hostSession } from './host-session';
import { QuizEditor } from './quiz-editor';

type AppKind = 'quiz' | 'lottery';

// UX-маппинг кодов configure/activate: известные коды ядра — человеческий текст,
// неизвестный — честный код (тот же стиль, что joinErrorText в play).
const submitErrorText = (e: unknown): string => {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'REQUEST_INVALID':
        return 'Настройки не прошли проверку сервера.';
      case 'ROOM_TRANSITION_INVALID':
        return 'Комната уже активирована или закрыта.';
      case 'ACTOR_NOT_ORGANIZER':
        return 'Эта комната принадлежит другому организатору.';
      default:
        return `Не удалось сохранить (${e.code}). Попробуйте ещё раз.`;
    }
  }
  return 'Ошибка сети. Попробуйте ещё раз.';
};

// Setup комнаты организатора (дизайн Task 13): комната (DRAFT) создаётся при
// входе на страницу или переиспользуется сохранённая; выбор приложения — квиз
// (редактор) или лотерея (атрибут розыгрыша); submit → configureRoom →
// activateRoom → консоль.
export function SetupPage() {
  const navigate = useNavigate();
  // Проактивный refresh по пробуждению (находка Н13, дизайн §3(Г)): setup —
  // место первого случая Н1 (configure), токен обязан быть свежим до submit.
  useSessionWakeRefresh(hostSession);
  const [roomId, setRoomId] = useState<string | null>(() => SessionStore.loadHostRoomId());
  const [roomError, setRoomError] = useState<string | null>(null);
  const [appKind, setAppKind] = useState<AppKind>('quiz');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const createStarted = useRef(false);

  // Гейт /host обязан пройти раньше: прямая перезагрузка /host/new без токена
  // возвращается на гейт — он сделает refresh и приведёт обратно.
  useEffect(() => {
    if (!hostSession.getAccessToken()) navigate('/host', { replace: true });
  }, [navigate]);

  // Комната организатора — одна (MVP): сохранённый roomId переиспользуем, иначе
  // создаём DRAFT. StrictMode дёргает effect дважды — ref страхует от второго
  // createRoom (плодить комнаты нельзя).
  useEffect(() => {
    if (!hostSession.getAccessToken() || roomId || createStarted.current) return;
    createStarted.current = true;
    createRoom(hostClient, { joinPolicy: 'guests' })
      .then((r) => {
        SessionStore.saveHostRoomId(r.roomId);
        // Код приезжает также в ответах configure/activate (toRoomResponse), но
        // после перезагрузки консоли перечитать его неоткуда (endpoint'а
        // «room по roomId» нет); консоль строит из него ссылки /play/<code> и
        // /screen/<code> — сохраняем сразу.
        SessionStore.saveHostRoomCode(r.code);
        setRoomId(r.roomId);
      })
      .catch(() => setRoomError('Не удалось создать комнату. Обновите страницу.'));
  }, [roomId]);

  // Общий финал обоих приложений: configure → activate → консоль. activate
  // отдельным вызовом после configure — lifecycle-команды ядра не комбинируются.
  const finalize = (appId: string, manifestVersion: number, settings: Record<string, unknown>) => {
    if (!roomId || busy) return;
    setBusy(true);
    setSubmitError(null);
    void configureRoom(hostClient, roomId, { appId, manifestVersion, settings })
      .then(() => activateRoom(hostClient, roomId))
      .then(() => navigate(HOST_CONSOLE_PATH))
      .catch((e: unknown) => setSubmitError(submitErrorText(e)))
      .finally(() => setBusy(false));
  };

  const submitQuiz = (settings: QuizSettings) =>
    finalize(QUIZ_APP_ID, QUIZ_MANIFEST_VERSION, settings);

  const submitLottery = () =>
    // ADR-012 §4: draw_eligibility удалена (verified-ветка приостановлена —
    // REGISTERED только организатор); settings-схема лотереи — пустая (I-5:
    // точка расширения манифеста). parse — та же серверная схема.
    finalize(LOTTERY_APP_ID, LOTTERY_MANIFEST_VERSION, lotterySettingsSchema.parse({}));

  if (roomError) {
    return (
      <main className="console-page">
        <p role="alert" className="console-error">
          {roomError}
        </p>
      </main>
    );
  }
  if (!roomId) {
    return (
      <main className="console-page">
        <p className="console-note">Создаём комнату…</p>
      </main>
    );
  }

  // Палитра/классы консоли (Task 10, мокапы forms-and-system-states-v2 /
  // editor-secondary-button-darker): каркас console-page, заголовок display-
  // шрифтом, выбор приложения — карточкой; поведение не меняется.
  return (
    <main className="console-page">
      <h1 className="setup-title">Настройка комнаты</h1>
      <fieldset className="console-card setup-appkind" disabled={busy}>
        <legend className="editor-legend">Приложение</legend>
        <label className="setup-appkind-option">
          <input
            type="radio"
            name="app-kind"
            checked={appKind === 'quiz'}
            onChange={() => setAppKind('quiz')}
          />
          Квиз
        </label>
        <label className="setup-appkind-option">
          <input
            type="radio"
            name="app-kind"
            checked={appKind === 'lottery'}
            onChange={() => setAppKind('lottery')}
          />
          Лотерея
        </label>
      </fieldset>
      {appKind === 'quiz' ? (
        <QuizEditor onSubmit={submitQuiz} busy={busy} />
      ) : (
        <form
          className="editor-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitLottery();
          }}
        >
          <button type="submit" className="btn btn-primary editor-submit" disabled={busy}>
            {/* Busy-индикация на время configure+activate (находка Н1 — первый
                случай был именно здесь; дизайн §3(Б)). */}
            {busy ? 'Сохраняем…' : 'Сохранить и запустить'}
          </button>
        </form>
      )}
      {submitError ? (
        <p role="alert" className="console-error">
          {submitError}
        </p>
      ) : null}
    </main>
  );
}
