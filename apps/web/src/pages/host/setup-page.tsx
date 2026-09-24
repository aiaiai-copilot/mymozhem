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
import { SessionStore } from '../../state/session';
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
  const [roomId, setRoomId] = useState<string | null>(() => SessionStore.loadHostRoomId());
  const [roomError, setRoomError] = useState<string | null>(null);
  const [appKind, setAppKind] = useState<AppKind>('quiz');
  const [drawEligibility, setDrawEligibility] = useState<'guests_allowed' | 'verified'>(
    'guests_allowed',
  );
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
      .then(() => navigate('/host/console'))
      .catch((e: unknown) => setSubmitError(submitErrorText(e)))
      .finally(() => setBusy(false));
  };

  const submitQuiz = (settings: QuizSettings) =>
    finalize(QUIZ_APP_ID, QUIZ_MANIFEST_VERSION, settings);

  const submitLottery = () =>
    // Дефолт схемы — guests_allowed: шлём явно выбранное значение (для дефолта
    // эквивалентно {}, но прозрачнее); parse — та же серверная схема.
    finalize(
      LOTTERY_APP_ID,
      LOTTERY_MANIFEST_VERSION,
      lotterySettingsSchema.parse({ drawEligibility }),
    );

  if (roomError) {
    return (
      <main>
        <p role="alert">{roomError}</p>
      </main>
    );
  }
  if (!roomId) {
    return (
      <main>
        <p>Создаём комнату…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Настройка комнаты</h1>
      <fieldset disabled={busy}>
        <legend>Приложение</legend>
        <label>
          <input
            type="radio"
            name="app-kind"
            checked={appKind === 'quiz'}
            onChange={() => setAppKind('quiz')}
          />
          Квиз
        </label>
        <label>
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
          onSubmit={(e) => {
            e.preventDefault();
            submitLottery();
          }}
        >
          <fieldset disabled={busy}>
            <legend>Кто участвует в розыгрыше</legend>
            <label>
              <input
                type="radio"
                name="draw-eligibility"
                checked={drawEligibility === 'guests_allowed'}
                onChange={() => setDrawEligibility('guests_allowed')}
              />
              Все участники, включая гостей
            </label>
            <label>
              <input
                type="radio"
                name="draw-eligibility"
                checked={drawEligibility === 'verified'}
                onChange={() => setDrawEligibility('verified')}
              />
              Только зарегистрированные
            </label>
          </fieldset>
          <button type="submit" disabled={busy}>
            Сохранить и запустить
          </button>
        </form>
      )}
      {submitError ? <p role="alert">{submitError}</p> : null}
    </main>
  );
}
