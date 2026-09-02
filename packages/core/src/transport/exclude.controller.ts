import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { excludeRequestSchema, type ExcludeResponse } from '@mymozhem/sdk';
import { z } from 'zod';
import { MembershipService } from '../membership/membership.service';
import { ActorNotMemberError } from '../membership/membership.errors';
import { TokenService } from '../auth/token.service';
import { authenticate } from './authenticate';
import type { RequestLike } from './http.types';

// actorId НЕ принимается из payload/path — актор определяется только access JWT
// (REQ-RT-009 по духу HTTP, прецедент JoinController). ZodError/доменные ошибки
// уходят в фильтр — контроллер статусов не знает (design §5).
@Controller()
export class ExcludeController {
  constructor(
    private readonly membership: MembershipService,
    private readonly tokens: TokenService,
  ) {}

  @Post('rooms/:roomId/members/:identityId/exclude')
  @HttpCode(200)
  async exclude(
    @Param('roomId') roomId: string,
    @Param('identityId') identityId: string,
    @Body() body: unknown,
    @Req() req: RequestLike,
  ): Promise<ExcludeResponse> {
    const claims = authenticate(req, this.tokens);
    const parsedRoomId = z.uuid().parse(roomId);
    const { reason } = excludeRequestSchema.parse(body ?? {});
    // REQ-ID-016: гостевой scope зашит в токен — GUEST действует только в своей
    // комнате (та же норма, что guest-scope в subscribe).
    if (claims.kind === 'GUEST' && claims.roomId !== parsedRoomId) {
      throw new ActorNotMemberError(`guest token scoped to ${claims.roomId}, not ${parsedRoomId}`);
    }
    return this.membership.exclude({
      roomId: parsedRoomId,
      targetIdentityId: z.uuid().parse(identityId),
      actorId: claims.sub,
      reason,
    });
  }
}
