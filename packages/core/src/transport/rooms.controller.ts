import { Body, Controller, Post, Req } from '@nestjs/common';
import { createRoomRequestSchema, type CreateRoomResponse } from '@mymozhem/sdk';
import { RoomService } from '../room/room.service';
import { RoomOrganizerNotRegisteredError } from '../room/room.errors';
import { TokenService } from '../auth/token.service';
import { authenticate } from './authenticate';
import type { RequestLike } from './http.types';

// POST /rooms (REQ-ID-005 HTTP-путь, design §6): организатор — только REGISTERED.
// GUEST отсекается до домена тем же кодом, что DB-гейт RoomService.create.
@Controller()
export class RoomsController {
  constructor(
    private readonly rooms: RoomService,
    private readonly tokens: TokenService,
  ) {}

  @Post('rooms')
  async create(@Body() body: unknown, @Req() req: RequestLike): Promise<CreateRoomResponse> {
    const claims = authenticate(req, this.tokens);
    if (claims.kind !== 'REGISTERED') {
      throw new RoomOrganizerNotRegisteredError(`token kind ${claims.kind} cannot organize`);
    }
    const { joinPolicy } = createRoomRequestSchema.parse(body ?? {});
    const room = await this.rooms.create(claims.sub, joinPolicy);
    return {
      roomId: room.id,
      code: room.code,
      // Echo провалидированного входа, не room.joinPolicy: сервис вставляет ровно это
      // значение или падает, а Prisma-имя enum ('GUESTS') ≠ SDK-lowercase ('guests') —
      // тот же @map-разрыв, что re-read в RoomService.insertRoom.
      joinPolicy,
      status: room.status,
    };
  }
}
