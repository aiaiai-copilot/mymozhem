import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/api-error';
import { joinErrorCode, joinErrorText, reconnectBannerVisible } from './use-room-binding';

// Код отказа стартового join (находка №3): консоль различает «комната из прошлой
// БД» (ACTOR_NOT_MEMBER → экран «не найдена») и сетевой обрыв (баннер). Хук
// без DOM-тестов (нет @testing-library/react — известный deferred T10), поэтому
// маппинг — чистая функция.
describe('joinErrorCode', () => {
  it('ApiError → wire-код', () => {
    expect(joinErrorCode(new ApiError('ACTOR_NOT_MEMBER', 0))).toBe('ACTOR_NOT_MEMBER');
    expect(joinErrorCode(new ApiError('NOT_FOUND', 404))).toBe('NOT_FOUND');
  });

  it('не-ApiError (сеть, ZodError) → null', () => {
    expect(joinErrorCode(new TypeError('fetch failed'))).toBeNull();
    expect(joinErrorCode(new Error('boom'))).toBeNull();
    expect(joinErrorCode('строка')).toBeNull();
  });
});

// Поверхность отказа стартовой подписки (carry финревью батча A → фикс-волна
// батча C): join после T1 может отказать ApiError('SUBSCRIBE_TIMEOUT') — до
// фикса это давало только общий баннер «переподключаемся». Подписка сама не
// восстанавливается (join не идемпотентен), поэтому честный текст с явным
// советом. Функция общая для play/console/screen — живёт рядом с joinErrorCode.
describe('joinErrorText', () => {
  it('SUBSCRIBE_TIMEOUT → текст про неподтверждённое подключение с советом', () => {
    expect(joinErrorText('SUBSCRIBE_TIMEOUT')).toBe(
      'Комната не подтвердила подключение — проверьте связь и обновите страницу.',
    );
  });

  it('прочие коды и null (сеть до T1) → отдельной поверхности нет', () => {
    expect(joinErrorText('ACTOR_NOT_MEMBER')).toBeNull();
    expect(joinErrorText('SESSION_INVALID')).toBeNull();
    expect(joinErrorText(null)).toBeNull();
  });
});

// Баннер «переподключаемся» честен, только пока reconnect действительно идёт
// (финревью батча C, Important 1): после упавшего СТАРТОВОГО join никто не
// переподключается (re-subscribe под гардом joined в RoomConnection) — баннер
// при живой joinErrorSurface врёт и противоречит alert'у («не трогай» рядом с
// «обновите страницу»).
describe('reconnectBannerVisible', () => {
  it('disconnected без поверхности join → баннер виден', () => {
    expect(reconnectBannerVisible('disconnected', null)).toBe(true);
  });

  it('disconnected с поверхностью join → баннер скрыт (говорит alert)', () => {
    expect(reconnectBannerVisible('disconnected', 'Комната не подтвердила…')).toBe(false);
  });

  it('live/connecting → reconnect-баннера нет в любом случае', () => {
    expect(reconnectBannerVisible('live', null)).toBe(false);
    expect(reconnectBannerVisible('connecting', null)).toBe(false);
    expect(reconnectBannerVisible('connecting', 'текст')).toBe(false);
  });
});
