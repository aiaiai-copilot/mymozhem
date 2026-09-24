import { afterEach, describe, expect, it, vi } from 'vitest';
import { z, ZodError } from 'zod';
import {
  awardResponseSchema,
  createRoomResponseSchema,
  excludeResponseSchema,
  listPrizesResponseSchema,
  listRewardsResponseSchema,
  prizeResponseSchema,
  rosterResponseSchema,
  tokenResponseSchema,
} from '@mymozhem/sdk';
import { ApiClient, type ApiRequest } from './api-client';
import { ApiError } from './api-error';
import type { TokenProvider } from './token-provider';
import {
  activateRoom,
  cancelRoom,
  completeRoom,
  configureRoom,
  createPrize,
  createRoom,
  excludeMember,
  fulfillAward,
  joinRoom,
  listMembers,
  listPrizes,
  listRewards,
  refreshSession,
  revokeAward,
} from './endpoints';

// Фейк провайдера токенов: refresh() имитирует silent-обновление access-токена
// (новый токен должен уехать в retry — Review Focus 4).
class FakeTokens implements TokenProvider {
  refreshed = 0;
  constructor(
    private token: string | null,
    private readonly tokenAfterRefresh: string | null = null,
  ) {}
  getAccessToken(): string | null {
    return this.token;
  }
  async refresh(): Promise<void> {
    this.refreshed += 1;
    this.token = this.tokenAfterRefresh;
  }
}

type FetchCall = { input: unknown; init?: RequestInit };

// Записывающий fetch-стаб: ответы отдаёт из очереди, вызовы — в журнал для ассертов.
const stubFetch = (...responses: Response[]) => {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    const next = queue.shift();
    if (!next) throw new Error('fetch вызван больше раз, чем заготовлено ответов');
    return next;
  });
  return calls;
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const IDENTITY_ID = '22222222-2222-4222-8222-222222222222';
const AWARD_ID = '33333333-3333-4333-8333-333333333333';

describe('ApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('валидирует ok-ответ схемой и возвращает типизированный результат', async () => {
    const client = new ApiClient(new FakeTokens('token-1'));
    const calls = stubFetch(jsonResponse(200, { members: [] }));

    const result = await client.call({ method: 'GET', path: '/rooms/x/members', schema: rosterResponseSchema });

    expect(result).toEqual({ members: [] });
    // same-origin — refresh-кука Strict, CORS не используется (дизайн §0.3).
    expect(calls[0]?.init?.credentials).toBe('same-origin');
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer token-1');
  });

  it('дрейф контракта → ZodError (fail-loud)', async () => {
    const client = new ApiClient(new FakeTokens('token-1'));
    stubFetch(jsonResponse(200, { members: [{ unexpected: 'shape' }] }));

    await expect(
      client.call({ method: 'GET', path: '/rooms/x/members', schema: rosterResponseSchema }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('401 → один refresh → один retry с новым токеном', async () => {
    const tokens = new FakeTokens('old-token', 'new-token');
    const client = new ApiClient(tokens);
    const calls = stubFetch(
      jsonResponse(401, { code: 'UNAUTHORIZED' }),
      jsonResponse(200, { members: [] }),
    );

    const result = await client.call({ method: 'GET', path: '/rooms/x/members', schema: rosterResponseSchema });

    expect(result).toEqual({ members: [] });
    expect(tokens.refreshed).toBe(1);
    expect(calls).toHaveLength(2);
    expect((calls[1]?.init?.headers as Record<string, string>).authorization).toBe('Bearer new-token');
  });

  it('повторный 401 → ApiError, без бесконечного retry (Review Focus 4)', async () => {
    const tokens = new FakeTokens('old-token', 'new-token');
    const client = new ApiClient(tokens);
    const calls = stubFetch(
      jsonResponse(401, { code: 'UNAUTHORIZED' }),
      jsonResponse(401, { code: 'UNAUTHORIZED' }),
    );

    const err = await client
      .call({ method: 'GET', path: '/rooms/x/members', schema: rosterResponseSchema })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(tokens.refreshed).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it('тело ошибки { code } → ApiError с этим кодом; без code → HTTP_<status>', async () => {
    const client = new ApiClient(new FakeTokens('token-1'));
    stubFetch(jsonResponse(403, { code: 'ROOM_JOIN_DENIED' }));
    const err = await client
      .call({ method: 'GET', path: '/x', schema: rosterResponseSchema })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('ROOM_JOIN_DENIED');
    expect((err as ApiError).status).toBe(403);

    // Тело не JSON (static-режим, прокси, 5xx-страница) — кода нет, бакет по статусу.
    vi.unstubAllGlobals();
    stubFetch(new Response('oops', { status: 500 }));
    const err2 = await client
      .call({ method: 'GET', path: '/x', schema: rosterResponseSchema })
      .catch((e: unknown) => e);
    expect(err2).toBeInstanceOf(ApiError);
    expect((err2 as ApiError).code).toBe('HTTP_500');
  });

  it('неизвестные wire-коды проходят as-is — клиент прозрачен, бакетинг выше', async () => {
    const client = new ApiClient(new FakeTokens('token-1'));
    // NOT_FOUND отдаёт static-режим serving'а — его нет в CONTRACT_ERROR_CODES.
    stubFetch(jsonResponse(404, { code: 'NOT_FOUND' }));
    const err = await client
      .call({ method: 'GET', path: '/x', schema: rosterResponseSchema })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('NOT_FOUND');
    expect((err as ApiError).status).toBe(404);

    // Произвольный будущий код тоже доезжает без фильтрации/whitelist'а.
    vi.unstubAllGlobals();
    stubFetch(jsonResponse(422, { code: 'SOME_FUTURE_CODE' }));
    const err2 = await client
      .call({ method: 'GET', path: '/x', schema: rosterResponseSchema })
      .catch((e: unknown) => e);
    expect((err2 as ApiError).code).toBe('SOME_FUTURE_CODE');
  });

  it('content-type только при теле: body-less POST уходит без него (fastify: пустой JSON body → 400)', async () => {
    const client = new ApiClient(new FakeTokens('token-1'));
    const calls = stubFetch(
      jsonResponse(200, { members: [] }),
      jsonResponse(200, { members: [] }),
    );

    // POST без body: fastify отвечает 400 FST_ERR_CTP_EMPTY_JSON_BODY, если
    // content-type: application/json выставлен при пустом теле — не выставляем.
    await client.call({ method: 'POST', path: '/auth/refresh', schema: rosterResponseSchema, auth: false });
    // POST с body: content-type обязателен, иначе сервер не распарсит JSON.
    await client.call({ method: 'POST', path: '/rooms', body: { joinPolicy: 'guests' }, schema: rosterResponseSchema });

    expect(calls[0]?.init?.body).toBeUndefined();
    expect((calls[0]?.init?.headers as Record<string, string>)['content-type']).toBeUndefined();
    expect(calls[1]?.init?.body).toBe('{"joinPolicy":"guests"}');
    expect((calls[1]?.init?.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('auth:false не шлёт authorization и не делает refresh при 401', async () => {    const tokens = new FakeTokens('token-1');
    const client = new ApiClient(tokens);
    const calls = stubFetch(jsonResponse(401, { code: 'ROOM_JOIN_DENIED' }));

    const err = await client
      .call({ method: 'POST', path: '/rooms/join', body: {}, schema: tokenResponseSchema, auth: false })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBeUndefined();
    expect(tokens.refreshed).toBe(0);
    expect(calls).toHaveLength(1);
  });
});

describe('endpoints', () => {
  // Записывающий клиент: endpoints — тонкие обёртки, проверяем метод/путь/схему/тело,
  // а не транспорт (он покрыт сьютом ApiClient выше).
  const makeRecordingClient = () => {
    const calls: ApiRequest<z.ZodType>[] = [];
    const client = {
      call: <S extends z.ZodType>(req: ApiRequest<S>): Promise<z.output<S>> => {
        calls.push(req as ApiRequest<z.ZodType>);
        return Promise.resolve(undefined as z.output<S>);
      },
    } as ApiClient;
    return { calls, client };
  };

  it('все 14 обёрток маппятся на пути/методы/схемы HTTP-контракта', async () => {
    const { calls, client } = makeRecordingClient();

    await joinRoom(client, { code: 'ABCD-1234', displayName: 'Гость' });
    await refreshSession(client);
    await createRoom(client, { joinPolicy: 'guests' });
    await configureRoom(client, ROOM_ID, { appId: 'quiz', manifestVersion: 1, settings: {} });
    await activateRoom(client, ROOM_ID);
    await completeRoom(client, ROOM_ID);
    await cancelRoom(client, ROOM_ID);
    await listMembers(client, ROOM_ID);
    await listPrizes(client, ROOM_ID);
    await createPrize(client, ROOM_ID, { name: 'Кубок', quantity: 3 });
    await listRewards(client, ROOM_ID);
    await fulfillAward(client, ROOM_ID, AWARD_ID);
    await revokeAward(client, ROOM_ID, AWARD_ID);
    await excludeMember(client, ROOM_ID, IDENTITY_ID, { reason: 'флуд' });

    const expected: Array<Pick<ApiRequest<z.ZodType>, 'method' | 'path' | 'schema'> & { auth?: boolean }> = [
      // join/refresh — без access-токена: refresh ездит httpOnly-кукой (REQ-ID-008).
      { method: 'POST', path: '/rooms/join', schema: tokenResponseSchema, auth: false },
      { method: 'POST', path: '/auth/refresh', schema: tokenResponseSchema, auth: false },
      { method: 'POST', path: '/rooms', schema: createRoomResponseSchema },
      { method: 'POST', path: `/rooms/${ROOM_ID}/configure`, schema: createRoomResponseSchema },
      { method: 'POST', path: `/rooms/${ROOM_ID}/activate`, schema: createRoomResponseSchema },
      { method: 'POST', path: `/rooms/${ROOM_ID}/complete`, schema: createRoomResponseSchema },
      { method: 'POST', path: `/rooms/${ROOM_ID}/cancel`, schema: createRoomResponseSchema },
      { method: 'GET', path: `/rooms/${ROOM_ID}/members`, schema: rosterResponseSchema },
      { method: 'GET', path: `/rooms/${ROOM_ID}/prizes`, schema: listPrizesResponseSchema },
      { method: 'POST', path: `/rooms/${ROOM_ID}/prizes`, schema: prizeResponseSchema },
      { method: 'GET', path: `/rooms/${ROOM_ID}/rewards`, schema: listRewardsResponseSchema },
      { method: 'POST', path: `/rooms/${ROOM_ID}/awards/${AWARD_ID}/fulfill`, schema: awardResponseSchema },
      { method: 'POST', path: `/rooms/${ROOM_ID}/awards/${AWARD_ID}/revoke`, schema: awardResponseSchema },
      { method: 'POST', path: `/rooms/${ROOM_ID}/members/${IDENTITY_ID}/exclude`, schema: excludeResponseSchema },
    ];

    expect(calls).toHaveLength(expected.length);
    expected.forEach((exp, i) => {
      expect(calls[i]?.method, `calls[${i}].method`).toBe(exp.method);
      expect(calls[i]?.path, `calls[${i}].path`).toBe(exp.path);
      expect(calls[i]?.schema, `calls[${i}].schema`).toBe(exp.schema);
      if (exp.auth !== undefined) expect(calls[i]?.auth, `calls[${i}].auth`).toBe(exp.auth);
    });
    // Тело join доезжает как есть — сервер валидирует по joinRequestSchema сам.
    expect(calls[0]?.body).toEqual({ code: 'ABCD-1234', displayName: 'Гость' });
  });
});
