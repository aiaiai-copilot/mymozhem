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

  // Ротация (REQ-ID-007) + проверки жизни гостевой сессии (REQ-ID-016). Все отказные
  // ветки — один SESSION_INVALID наружу; различие только в server-side message.
  async rotate(refreshToken: string): Promise<IssuedTokens> {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
    });
    if (!session) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'unknown refresh token');
    }
    if (session.replacedById !== null) {
      // Предъявлен уже ротированный токен — сигнал кражи: гасим всё семейство (REQ-ID-007).
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, `refresh reuse detected, family ${session.familyId} revoked`);
    }
    if (session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'session revoked or expired');
    }

    const identity = await this.prisma.identity.findUnique({ where: { id: session.identityId } });
    if (!identity || identity.deletedAt !== null) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'identity gone');
    }

    let roomId: string | undefined;
    if (identity.kind === 'GUEST') {
      if (identity.createdAt.getTime() + this.config.GUEST_TTL * 1000 <= Date.now()) {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'guest TTL expired');
      }
      // Гость живёт ровно в одной комнате — членство и есть scope сессии (design §4).
      const membership = await this.prisma.membership.findFirst({ where: { identityId: identity.id } });
      if (!membership) {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'membership gone');
      }
      const room = await this.prisma.room.findUnique({ where: { id: membership.roomId } });
      if (!room || room.status === 'COMPLETED' || room.status === 'CANCELLED' || room.deletedAt !== null) {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'room terminal');
      }
      roomId = membership.roomId;
    }

    const newRefreshToken = randomBytes(32).toString('base64url');
    const newSessionId = randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        // Атомарный захват ротации: проигравший гонку видит count=0 → SESSION_INVALID,
        // семейство НЕ ревокается (гонка ≠ кража, design §4).
        const claimed = await tx.session.updateMany({
          where: { id: session.id, replacedById: null, revokedAt: null, expiresAt: { gt: new Date() } },
          data: { replacedById: newSessionId },
        });
        if (claimed.count === 0) {
          throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, 'rotation race lost');
        }
        await tx.session.create({
          data: {
            id: newSessionId,
            identityId: session.identityId,
            refreshTokenHash: sha256(newRefreshToken),
            familyId: session.familyId,
            expiresAt: this.sessionExpiry(),
          },
        });
      });
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError(AUTH_ERROR_CODES.SESSION_INVALID, `rotation failed: ${(err as Error).message}`);
    }

    return {
      accessToken: this.signAccess({ sub: identity.id, sid: newSessionId, kind: identity.kind, roomId }),
      expiresIn: this.config.ACCESS_TOKEN_TTL,
      refreshToken: newRefreshToken,
    };
  }

  protected sessionExpiry(): Date {
    return new Date(Date.now() + Math.min(this.config.REFRESH_TOKEN_TTL, this.config.GUEST_TTL) * 1000);
  }

  protected signAccess(claims: AccessClaims): string {
    return jwt.sign(claims, this.config.JWT_SECRET, { algorithm: 'HS256', expiresIn: this.config.ACCESS_TOKEN_TTL });
  }
}
