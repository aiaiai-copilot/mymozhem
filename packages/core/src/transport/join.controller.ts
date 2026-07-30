import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import { joinRequestSchema, type TokenResponse } from '@mymozhem/sdk';
import { MembershipService } from '../membership/membership.service';
import { TokenService } from '../auth/token.service';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { setRefreshCookie } from './refresh-cookie';
import type { ReplyLike, RequestLike } from './http.types';

@Controller()
export class JoinController {
  constructor(
    private readonly membership: MembershipService,
    private readonly tokens: TokenService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // actorId НЕ принимается из payload — актор определяется только выданным токеном
  // (REQ-RT-009 по духу для HTTP). ZodError/доменные ошибки уходят в фильтр —
  // контроллер статусов не знает (design §5).
  @Post('rooms/join')
  async join(
    @Body() body: unknown,
    @Req() req: RequestLike,
    @Res({ passthrough: true }) reply: ReplyLike,
  ): Promise<TokenResponse> {
    const { code, displayName } = joinRequestSchema.parse(body);
    const { identity, membership } = await this.membership.join({ code, displayName, ip: req.ip });
    const issued = await this.tokens.issueGuestTokens(identity.id, membership.roomId);
    setRefreshCookie(reply, issued.refreshToken, this.config);
    return { accessToken: issued.accessToken, tokenType: 'Bearer', expiresIn: issued.expiresIn };
  }
}
