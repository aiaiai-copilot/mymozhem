import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import {
  awardResponseSchema,
  createPrizeRequestSchema,
  listPrizesResponseSchema,
  listRewardsResponseSchema,
  prizeResponseSchema,
  type AwardResponse,
  type ListPrizesResponse,
  type PrizeResponse,
} from '@mymozhem/sdk';
import type { Award, Prize } from '@prisma/client';
import { authenticate } from '../transport/authenticate';
import type { RequestLike } from '../transport/http.types';
import { TokenService } from '../auth/token.service';
import { RewardsService } from './rewards.service';

// REST-контур управления фондом и наградами (design 2026-09-10 §2): cross-app
// управляющие действия платформенного контура, не внутриигровые команды механики —
// поэтому HTTP с существующими гардами, а не realtime-команды. Проверка роли —
// в домене (RewardsService.assertOrganizer), контроллер статусов не знает.
// actorId — только из access JWT (REQ-RT-009 по духу HTTP, прецедент ExcludeController);
// ответная .parse на границе — прецедент RoomsController (createRoomResponseSchema.parse).
@Controller('rooms')
export class RewardsController {
  constructor(
    private readonly rewards: RewardsService,
    private readonly tokens: TokenService,
  ) {}

  @Post(':roomId/prizes')
  async createPrize(@Req() req: RequestLike, @Param('roomId') roomId: string): Promise<PrizeResponse> {
    const claims = authenticate(req, this.tokens);
    const parsedRoomId = z.uuid().parse(roomId);
    const body = (req as { body?: unknown }).body;
    const input = createPrizeRequestSchema.parse(body ?? {});
    const prize = await this.rewards.createPrize(parsedRoomId, claims.sub, input);
    return prizeResponseSchema.parse(toPrizeResponse(prize));
  }

  @Get(':roomId/rewards')
  async listRewards(@Req() req: RequestLike, @Param('roomId') roomId: string) {
    const claims = authenticate(req, this.tokens);
    const parsedRoomId = z.uuid().parse(roomId);
    const awards = await this.rewards.listAwards(parsedRoomId, claims.sub);
    return listRewardsResponseSchema.parse({ awards: awards.map(toAwardResponse) });
  }

  // Список призов с остатком фонда (UI-срез): зеркало listRewards; organizer-only
  // гейт — в домене (RewardsService.listPrizes).
  @Get(':roomId/prizes')
  async listPrizes(@Req() req: RequestLike, @Param('roomId') roomId: string): Promise<ListPrizesResponse> {
    const claims = authenticate(req, this.tokens);
    const prizes = await this.rewards.listPrizes(z.uuid().parse(roomId), claims.sub);
    return listPrizesResponseSchema.parse({ prizes: prizes.map(toPrizeResponse) });
  }

  @Post(':roomId/awards/:awardId/fulfill')
  @HttpCode(200)
  async fulfill(
    @Req() req: RequestLike,
    @Param('roomId') roomId: string,
    @Param('awardId') awardId: string,
  ): Promise<AwardResponse> {
    const claims = authenticate(req, this.tokens);
    const award = await this.rewards.fulfill(z.uuid().parse(roomId), z.uuid().parse(awardId), claims.sub);
    return awardResponseSchema.parse(toAwardResponse(award));
  }

  @Post(':roomId/awards/:awardId/revoke')
  @HttpCode(200)
  async revoke(
    @Req() req: RequestLike,
    @Param('roomId') roomId: string,
    @Param('awardId') awardId: string,
  ): Promise<AwardResponse> {
    const claims = authenticate(req, this.tokens);
    const award = await this.rewards.revoke(z.uuid().parse(roomId), z.uuid().parse(awardId), claims.sub);
    return awardResponseSchema.parse(toAwardResponse(award));
  }
}

function toPrizeResponse(p: Prize): PrizeResponse {
  return {
    id: p.id,
    roomId: p.roomId,
    name: p.name,
    quantityTotal: p.quantityTotal,
    quantity: p.quantity,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toAwardResponse(a: Award): AwardResponse {
  return {
    id: a.id,
    roomId: a.roomId,
    prizeId: a.prizeId,
    winnerId: a.winnerId,
    status: a.status,
    sourceAppId: a.sourceAppId,
    createdAt: a.createdAt.toISOString(),
    fulfilledAt: a.fulfilledAt?.toISOString() ?? null,
    revokedAt: a.revokedAt?.toISOString() ?? null,
  };
}
