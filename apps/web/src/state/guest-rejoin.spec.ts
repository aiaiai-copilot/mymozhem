import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api-client';
import { ApiError } from '../api/api-error';
import { createRejoinRetryListeners, rejoinAsGuest, rejoinFailureAction } from './guest-rejoin';

const makeToken = (claims: unknown): string =>
  `hdr.${btoa(JSON.stringify(claims))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}.sig`;

const anon = new ApiClient({ getAccessToken: () => null, refresh: () => Promise.resolve() });

// Автоперезаход (находка №5): мёртвая refresh-кука → новый join по сохранённым
// code/displayName. roomId берём из claims нового токена, а не из ответа формы —
// одна точка правды с авто-входом §5.
describe('rejoinAsGuest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('join по сохранённым code/displayName → accessToken + roomId из claims', async () => {
    const token = makeToken({ sub: 'id-1', kind: 'GUEST', roomId: 'room-9', exp: 1_900_000_000 });
    // Тип-параметр vi.fn — сигнатура fetch: mock.calls типизирован
    // [string, RequestInit] для body-assert ниже (без него calls выводится как []).
    const fetchMock = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(async () =>
      new Response(
        // joinResponseSchema (SDK 2.0.0, strict): tokenResponse + displayName;
        // refreshToken в теле НЕТ — refresh живёт в httpOnly-куке.
        JSON.stringify({ accessToken: token, tokenType: 'Bearer', expiresIn: 900, displayName: 'Гость 7' }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await rejoinAsGuest(anon, { code: 'ABCD-2345', displayName: 'Гость 7' });

    expect(res).toEqual({ accessToken: token, roomId: 'room-9' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ code: 'ABCD-2345', displayName: 'Гость 7' });
  });

  it('токен без roomId → throw (fail-loud, не тихий null)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            accessToken: makeToken({ sub: 'id-1', kind: 'GUEST', exp: 1_900_000_000 }),
            tokenType: 'Bearer',
            expiresIn: 900,
            displayName: 'x',
          }),
          { status: 201 },
        ),
      ),
    );

    await expect(rejoinAsGuest(anon, { code: 'C', displayName: 'x' })).rejects.toThrow('roomId');
  });
});

// Классификация провала rejoin (находка Н13, дизайн §3(В), решение 4): смерть
// сессии — только по слову сервера; сетевой обрыв любой длины — пауза с
// повтором по online, личность (saved guest) не трогаем.
describe('rejoinFailureAction', () => {
  it('серверный отказ по существу (ApiError 4xx: комната терминальна, join отклонён) → terminal', () => {
    expect(rejoinFailureAction(new ApiError('ROOM_JOIN_DENIED', 403))).toBe('terminal');
    expect(rejoinFailureAction(new ApiError('NOT_FOUND', 404))).toBe('terminal');
  });

  it('сетевой обрыв (TypeError), инфраструктурный 5xx и неизвестное → retry', () => {
    expect(rejoinFailureAction(new TypeError('fetch failed'))).toBe('retry');
    expect(rejoinFailureAction(new ApiError('HTTP_502', 502))).toBe('retry');
    expect(rejoinFailureAction(new Error('boom'))).toBe('retry');
  });
});

// Повтор rejoin по пробуждению/online (находка Н13, финревью батча B).
// Фейк EventTarget: регистрация/снятие записываются, fire дёргает слушателей.
const makeTarget = () => {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener: (type: string, cb: () => void) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(cb));
    },
    removeEventListener: (type: string, cb: () => void) => {
      listeners.get(type)?.delete(cb);
    },
    fire: (type: string) => listeners.get(type)?.forEach((cb) => cb()),
    size: (type: string) => listeners.get(type)?.size ?? 0,
  };
};

describe('createRejoinRetryListeners', () => {
  it('retry подписан на online/focus/pageshow (window) и visibilitychange (document) — 5xx при ЖИВОЙ сети догоняется пробуждением', () => {
    // Только-online слушатель клинил страницу на «Входим…» навсегда при
    // временном отказе без падения сети (рестарт сервера → 502, online не
    // стреляет — дизайн §3(В): повтор при online/ПРОБУЖДЕНИИ).
    const win = makeTarget();
    const doc = makeTarget();
    const retry = vi.fn();

    createRejoinRetryListeners(retry, win, doc);

    win.fire('focus');
    doc.fire('visibilitychange');
    win.fire('pageshow');
    win.fire('online');
    expect(retry).toHaveBeenCalledTimes(4);
  });

  it('disposer снимает всех слушателей — сработка после unmount не создаёт сироту-identity на сервере', () => {
    // Без cleanup слушатель переживал страницу: rejoin после ухода пользователя
    // делал реальный joinRoom = новая гостевая identity + ротация refresh-куки.
    const win = makeTarget();
    const doc = makeTarget();
    const retry = vi.fn();

    const dispose = createRejoinRetryListeners(retry, win, doc);
    dispose();

    win.fire('online');
    win.fire('focus');
    win.fire('pageshow');
    doc.fire('visibilitychange');
    expect(retry).not.toHaveBeenCalled();
    expect(win.size('online')).toBe(0);
    expect(doc.size('visibilitychange')).toBe(0);
  });
});
