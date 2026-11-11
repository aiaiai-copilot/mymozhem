import { ApiError } from '../../api/api-error';

// UX-маппинг ошибок ответа участника (вынесен из play-page в T8 среза Н1/Н13 —
// чистая функция под unit-тестом, прецедент open-question-label.ts). Отказы
// транспорта (NOT_CONNECTED/PUBLISH_TIMEOUT, T1) — честная формулировка
// решения 7: ack-таймаут не значит «не исполнилось»; сервер отвечает на
// повтор конфликтом состояния, состояние сходится через realtime.
export const answerErrorText = (e: unknown): string => {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'ALREADY_ANSWERED':
        return 'Ответ уже принят.';
      case 'ROUND_NOT_OPEN':
        return 'Приём ответов закрыт.';
      case 'ANSWER_TOO_FAST':
        return 'Слишком быстро — попробуйте ещё раз.';
      case 'NOT_CONNECTED':
      case 'PUBLISH_TIMEOUT':
        return 'Нет подтверждения ответа — проверьте, не засчитан ли он, и нажмите ещё раз.';
      default:
        return `Ответ не принят (${e.code}).`;
    }
  }
  return 'Ошибка сети. Ответ не отправлен.';
};
