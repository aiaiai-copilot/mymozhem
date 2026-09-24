import {
  awardResponseSchema,
  createRoomResponseSchema,
  excludeResponseSchema,
  listPrizesResponseSchema,
  listRewardsResponseSchema,
  prizeResponseSchema,
  rosterResponseSchema,
  tokenResponseSchema,
  type AwardResponse,
  type ConfigureRoomRequest,
  type CreatePrizeRequest,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type ExcludeRequest,
  type ExcludeResponse,
  type JoinRequest,
  type ListPrizesResponse,
  type ListRewardsResponse,
  type PrizeResponse,
  type RosterResponse,
  type TokenResponse,
} from '@mymozhem/sdk';
import type { ApiClient } from './api-client';

// Тонкие обёртки эндпоинтов (дизайн §3): единственное место на клиенте, где известны
// пути HTTP-контракта (сверены с контроллерами ядра, packages/core/src/transport и
// rewards). Схемы ответов — только из SDK (единый источник истины, REQ-CTR-005).
// Lifecycle/configure отвечают формой createRoomResponseSchema — так парсит сервер
// (toRoomResponse), отдельной схемы в SDK нет и не нужно.

// join/refresh — auth:false: access-токена ещё нет, refresh ездит httpOnly-кукой
// (REQ-ID-008), Bearer на этих вызовах бессмысленнен.
export const joinRoom = (c: ApiClient, input: JoinRequest): Promise<TokenResponse> =>
  c.call({ method: 'POST', path: '/rooms/join', body: input, schema: tokenResponseSchema, auth: false });

export const refreshSession = (c: ApiClient): Promise<TokenResponse> =>
  c.call({ method: 'POST', path: '/auth/refresh', schema: tokenResponseSchema, auth: false });

export const createRoom = (c: ApiClient, input: CreateRoomRequest): Promise<CreateRoomResponse> =>
  c.call({ method: 'POST', path: '/rooms', body: input, schema: createRoomResponseSchema });

export const configureRoom = (
  c: ApiClient,
  roomId: string,
  input: ConfigureRoomRequest,
): Promise<CreateRoomResponse> =>
  c.call({ method: 'POST', path: `/rooms/${roomId}/configure`, body: input, schema: createRoomResponseSchema });

export const activateRoom = (c: ApiClient, roomId: string): Promise<CreateRoomResponse> =>
  c.call({ method: 'POST', path: `/rooms/${roomId}/activate`, schema: createRoomResponseSchema });

export const completeRoom = (c: ApiClient, roomId: string): Promise<CreateRoomResponse> =>
  c.call({ method: 'POST', path: `/rooms/${roomId}/complete`, schema: createRoomResponseSchema });

export const cancelRoom = (c: ApiClient, roomId: string): Promise<CreateRoomResponse> =>
  c.call({ method: 'POST', path: `/rooms/${roomId}/cancel`, schema: createRoomResponseSchema });

export const listMembers = (c: ApiClient, roomId: string): Promise<RosterResponse> =>
  c.call({ method: 'GET', path: `/rooms/${roomId}/members`, schema: rosterResponseSchema });

export const listPrizes = (c: ApiClient, roomId: string): Promise<ListPrizesResponse> =>
  c.call({ method: 'GET', path: `/rooms/${roomId}/prizes`, schema: listPrizesResponseSchema });

export const createPrize = (
  c: ApiClient,
  roomId: string,
  input: CreatePrizeRequest,
): Promise<PrizeResponse> =>
  c.call({ method: 'POST', path: `/rooms/${roomId}/prizes`, body: input, schema: prizeResponseSchema });

export const listRewards = (c: ApiClient, roomId: string): Promise<ListRewardsResponse> =>
  c.call({ method: 'GET', path: `/rooms/${roomId}/rewards`, schema: listRewardsResponseSchema });

export const fulfillAward = (c: ApiClient, roomId: string, awardId: string): Promise<AwardResponse> =>
  c.call({ method: 'POST', path: `/rooms/${roomId}/awards/${awardId}/fulfill`, schema: awardResponseSchema });

export const revokeAward = (c: ApiClient, roomId: string, awardId: string): Promise<AwardResponse> =>
  c.call({ method: 'POST', path: `/rooms/${roomId}/awards/${awardId}/revoke`, schema: awardResponseSchema });

// reason опционален (REQ-ID-006): без тела сервер парсит {} — повторное исключение
// типизированный no-op (excluded:false).
export const excludeMember = (
  c: ApiClient,
  roomId: string,
  identityId: string,
  input?: ExcludeRequest,
): Promise<ExcludeResponse> =>
  c.call({
    method: 'POST',
    path: `/rooms/${roomId}/members/${identityId}/exclude`,
    body: input,
    schema: excludeResponseSchema,
  });
