import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { OAUTH_ERROR_CODES, OAuthError } from './oauth.errors';
import type { OAuthProviderClient, ProviderProfile } from './oauth-provider.client';

// Единственный файл с сетевым кодом Google (design §2). Сырые ответы — loose-схемы:
// лишние поля Google нам безразличны, обязательные — fail-closed.
const googleTokenResponseSchema = z.looseObject({ access_token: z.string().min(1) });
const googleUserinfoSchema = z.looseObject({
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.boolean().default(false), // default — fail-closed к «не verified»
  name: z.string().optional(),
});

@Injectable()
export class GoogleOAuthClient implements OAuthProviderClient {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async exchangeCode(code: string, pkceVerifier: string): Promise<ProviderProfile> {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_REDIRECT_URI } = this.config;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !OAUTH_REDIRECT_URI) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_NOT_CONFIGURED, 'google oauth not configured');
    }
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: OAUTH_REDIRECT_URI,
        grant_type: 'authorization_code',
        code_verifier: pkceVerifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) throw new Error(`google token endpoint: ${tokenRes.status}`);
    const tokenBody = googleTokenResponseSchema.parse(await tokenRes.json());
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tokenBody.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!infoRes.ok) throw new Error(`google userinfo: ${infoRes.status}`);
    const info = googleUserinfoSchema.parse(await infoRes.json());
    return { subject: info.sub, email: info.email, emailVerified: info.email_verified, displayName: info.name };
  }
}
