import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import {
  configureRoomRequestSchema,
  createRoomResponseSchema,
  type CreateRoomResponse,
} from '@mymozhem/sdk';
import type { Room } from '@prisma/client';
import { authenticate } from './authenticate';
import type { RequestLike } from './http.types';
import { TokenService } from '../auth/token.service';
import { RoomService } from '../room/room.service';
import { MembershipService } from '../membership/membership.service';

// HTTP-контур lifecycle комнаты (дизайн UI-среза, решение №9): до среза configure/
// activate/complete/cancel существовали только сервисным путём. Проверка роли — в
// домене (membership.assertOrganizer) до операции; actorId перехода — из access JWT
// (REQ-RT-009 по духу HTTP). Ответная .parse на границе — прецедент RoomsController.
// @HttpCode(200): ресурс не создаётся — 201 по умолчанию Nest здесь семантически неверен
// (прецедент @HttpCode(200) на fulfill/revoke в RewardsController).
@Controller('rooms')
export class RoomsLifecycleController {
  constructor(
    private readonly rooms: RoomService,
    private readonly membership: MembershipService,
    private readonly tokens: TokenService,
  ) {}

  @Post(':roomId/configure')
  @HttpCode(200)
  async configure(
    @Req() req: RequestLike,
    @Param('roomId') roomId: string,
    @Body() body: unknown,
  ): Promise<CreateRoomResponse> {
    const claims = authenticate(req, this.tokens);
    const id = z.uuid().parse(roomId);
    await this.membership.assertOrganizer(id, claims.sub);
    const input = configureRoomRequestSchema.parse(body ?? {});
    return createRoomResponseSchema.parse(toRoomResponse(await this.rooms.configure(id, input)));
  }

  @Post(':roomId/activate')
  @HttpCode(200)
  async activate(@Req() req: RequestLike, @Param('roomId') roomId: string): Promise<CreateRoomResponse> {
    return this.transition(req, roomId, (r, actor) => this.rooms.activate(r, actor));
  }

  @Post(':roomId/complete')
  @HttpCode(200)
  async complete(@Req() req: RequestLike, @Param('roomId') roomId: string): Promise<CreateRoomResponse> {
    return this.transition(req, roomId, (r, actor) => this.rooms.complete(r, actor));
  }

  @Post(':roomId/cancel')
  @HttpCode(200)
  async cancel(@Req() req: RequestLike, @Param('roomId') roomId: string): Promise<CreateRoomResponse> {
    return this.transition(req, roomId, (r, actor) => this.rooms.cancel(r, actor));
  }

  private async transition(
    req: RequestLike,
    roomId: string,
    op: (roomId: string, actorId: string) => Promise<Room>,
  ): Promise<CreateRoomResponse> {
    const claims = authenticate(req, this.tokens);
    const id = z.uuid().parse(roomId);
    await this.membership.assertOrganizer(id, claims.sub);
    return createRoomResponseSchema.parse(toRoomResponse(await op(id, claims.sub)));
  }
}

// Prisma-enum uppercase ('GUESTS') → SDK-lowercase ('guests') — @map-разрыв, тот же,
// что echo в RoomsController.create (здесь echo невозможен: входа joinPolicy нет).
const toRoomResponse = (room: Room): CreateRoomResponse => ({
  roomId: room.id,
  code: room.code,
  joinPolicy: room.joinPolicy.toLowerCase() as CreateRoomResponse['joinPolicy'],
  status: room.status,
});
