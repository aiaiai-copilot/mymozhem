import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/api-error';
import { answerErrorText } from './answer-error-text';

// Тексты отказа ответа участника (находка Н1, решение 7): честная формулировка
// «нет подтверждения — проверьте, не применилось ли», НЕ «точно не отправлено»
// (ack-таймаут не значит, что команда не исполнилась). Коды NOT_CONNECTED /
// PUBLISH_TIMEOUT — из RoomConnection (T1); сетевой TypeError — прежний текст.
describe('answerErrorText', () => {
  it('NOT_CONNECTED и PUBLISH_TIMEOUT → «Нет подтверждения…» (решение 7)', () => {
    expect(answerErrorText(new ApiError('NOT_CONNECTED', 0))).toBe(
      'Нет подтверждения ответа — проверьте, не засчитан ли он, и нажмите ещё раз.',
    );
    expect(answerErrorText(new ApiError('PUBLISH_TIMEOUT', 0))).toBe(
      'Нет подтверждения ответа — проверьте, не засчитан ли он, и нажмите ещё раз.',
    );
  });

  it('известные коды — прежние человеческие формулировки', () => {
    expect(answerErrorText(new ApiError('ALREADY_ANSWERED', 409))).toBe('Ответ уже принят.');
    expect(answerErrorText(new ApiError('ROUND_NOT_OPEN', 409))).toBe('Приём ответов закрыт.');
    expect(answerErrorText(new ApiError('ANSWER_TOO_FAST', 429))).toBe(
      'Слишком быстро — попробуйте ещё раз.',
    );
  });

  it('неизвестный код — прежний честный код', () => {
    expect(answerErrorText(new ApiError('WHAT_EVER', 400))).toBe('Ответ не принят (WHAT_EVER).');
  });

  it('не-ApiError (сеть) — прежнее «Ошибка сети…»', () => {
    expect(answerErrorText(new TypeError('fetch failed'))).toBe('Ошибка сети. Ответ не отправлен.');
  });
});
