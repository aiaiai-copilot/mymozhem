import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api-client';
import { rejoinAsGuest } from './guest-rejoin';

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
    const token = makeToken({ sub: 'id-1', kind: 'GUEST', roomId: 'room-9' });
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
            accessToken: makeToken({ sub: 'id-1', kind: 'GUEST' }),
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
