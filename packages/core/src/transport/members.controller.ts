import { Controller, Get, Param, Req } from '@nestjs/common';
import { z } from 'zod';
import { rosterResponseSchema, type RosterResponse } from '@mymozhem/sdk';
import { authenticate } from './authenticate';
import type { RequestLike } from './http.types';
import { TokenService } from '../auth/token.service';
import { MembershipService } from '../membership/membership.service';

// Ростер комнаты (дизайн UI-среза, решение №10): любой активный член; displayName
// null после TTL-свипа; Prisma-роль uppercase → wire lowercase (прецедент join).
@Controller('rooms')
export class MembersController {
  constructor(
    private readonly membership: MembershipService,
    private readonly tokens: TokenService,
  ) {}

  @Get(':roomId/members')
  async list(@Req() req: RequestLike, @Param('roomId') roomId: string): Promise<RosterResponse> {
    const claims = authenticate(req, this.tokens);
    const id = z.uuid().parse(roomId);
    await this.membership.assertMember(id, claims.sub);
    const roster = await this.membership.listRoster(id);
    return rosterResponseSchema.parse({
      members: roster.map((m) => ({
        identityId: m.identityId,
        displayName: m.displayName,
        role: m.role.toLowerCase() as RosterResponse['members'][number]['role'],
      })),
    });
  }
}
