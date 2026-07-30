import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { AUTH_ERROR_CODES, AuthError } from './auth.errors';

export interface AccessClaims {
  sub: string; // identityId
  sid: string; // session id
  kind: 'GUEST' | 'REGISTERED';
  roomId?: string; // guest scope (REQ-ID-016); REGISTERED — без roomId
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // Единственная выдача в этом срезе — гостевая (REQ-ID-016): roomId зашит в claims.
  async issueGuestTokens(identityId: string, roomId: string): Promise<IssuedTokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    const session = await this.prisma.session.create({
      data: {
        identityId,
        refreshTokenHash: sha256(refreshToken),
        familyId: randomUUID(),
        expiresAt: this.sessionExpiry(),
      },
    });
    return {
      accessToken: this.signAccess({ sub: identityId, sid: session.id, kind: 'GUEST', roomId }),
      expiresIn: this.config.ACCESS_TOKEN_TTL,
      refreshToken,
    };
  }

  // Access — stateless; verify используется будущим realtime-handshake (REQ-RT-009).
  verifyAccessToken(token: string): AccessClaims {
    let decoded: jwt.JwtPayload;
    try {
      const raw = jwt.verify(token, this.config.JWT_SECRET, { algorithms: ['HS256'] });
      if (typeof raw === 'string') throw new Error('string payload');
      decoded = raw;
    } catch (err) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, `access verify failed: ${(err as Error).message}`);
    }
    if (
      typeof decoded.sub !== 'string' ||
      typeof decoded.sid !== 'string' ||
      (decoded.kind !== 'GUEST' && decoded.kind !== 'REGISTERED')
    ) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'access claims malformed');
    }
    return { sub: decoded.sub, sid: decoded.sid, kind: decoded.kind, roomId: typeof decoded.roomId === 'string' ? decoded.roomId : undefined };
  }

  protected sessionExpiry(): Date {
    return new Date(Date.now() + Math.min(this.config.REFRESH_TOKEN_TTL, this.config.GUEST_TTL) * 1000);
  }

  protected signAccess(claims: AccessClaims): string {
    return jwt.sign(claims, this.config.JWT_SECRET, { algorithm: 'HS256', expiresIn: this.config.ACCESS_TOKEN_TTL });
  }
}
