import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Identity } from '@prisma/client';
import { IdentityService } from '../identity/identity.service';
import { IdentityError, IDENTITY_ERROR_CODES } from '../identity/identity.errors';
import { TokenService, type IssuedTokens } from '../auth/token.service';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { OAUTH_ERROR_CODES, OAuthError } from './oauth.errors';
import { OAUTH_PKCE_COOKIE, OAUTH_REDIRECT_COOKIE, OAUTH_STATE_COOKIE } from './oauth.constants';
import { OAUTH_PROVIDER_CLIENT, type OAuthProviderClient, type ProviderProfile } from './oauth-provider.client';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export interface OAuthStartResult {
  authorizeUrl: string;
  cookies: { name: string; value: string }[];
}

export interface OAuthCompleteInput {
  code?: string | undefined;
  state?: string | undefined;
  error?: string | undefined;
  cookies: Record<string, string | undefined>;
}

export interface OAuthCompleteResult {
  identityId: string;
  tokens: IssuedTokens;
  redirectTarget: string;
}

@Injectable()
export class OAuthService {
  constructor(
    private readonly identity: IdentityService,
    private readonly tokens: TokenService,
    @Inject(OAUTH_PROVIDER_CLIENT) private readonly provider: OAuthProviderClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // REQ-ID-009: state — double-submit (nonce в httpOnly-куке === state в query),
  // PKCE S256; redirect — только из allowlist, перепроверяется и на complete.
  start(redirect?: string): OAuthStartResult {
    const cfg = this.googleConfig();
    const target = this.validateRedirect(redirect);
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const url = new URL(GOOGLE_AUTHORIZE_URL);
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', cfg.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', nonce);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return {
      authorizeUrl: url.toString(),
      cookies: [
        { name: OAUTH_STATE_COOKIE, value: nonce },
        { name: OAUTH_PKCE_COOKIE, value: verifier },
        { name: OAUTH_REDIRECT_COOKIE, value: target },
      ],
    };
  }

  async complete(input: OAuthCompleteInput): Promise<OAuthCompleteResult> {
    this.googleConfig();
    if (input.error !== undefined) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_ACCESS_DENIED, `google error: ${input.error}`);
    }
    const stateCookie = input.cookies[OAUTH_STATE_COOKIE];
    if (!stateCookie || !input.state || input.state !== stateCookie || !input.code) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_STATE_INVALID, 'state mismatch or code missing');
    }
    const verifier = input.cookies[OAUTH_PKCE_COOKIE];
    const redirectCookie = input.cookies[OAUTH_REDIRECT_COOKIE];
    if (!verifier || !redirectCookie) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_STATE_INVALID, 'oauth cookies missing');
    }
    // Кука httpOnly, но не подписана — allowlist перепроверяется и здесь (design §3).
    const redirectTarget = this.validateRedirect(redirectCookie);
    let profile: ProviderProfile;
    try {
      profile = await this.provider.exchangeCode(input.code, verifier);
    } catch (err) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_EXCHANGE_FAILED, `code exchange failed: ${(err as Error).message}`);
    }
    if (profile.emailVerified !== true) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_EMAIL_UNVERIFIED, `email not verified (sub ${profile.subject})`);
    }
    let identity: Identity;
    try {
      identity = await this.identity.findOrCreateByProvider({
        provider: 'google',
        subject: profile.subject,
        email: profile.email,
        displayName: profile.displayName,
      });
    } catch (err) {
      if (err instanceof IdentityError && err.code === IDENTITY_ERROR_CODES.EMAIL_CONFLICT) {
        throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_EMAIL_CONFLICT, err.message);
      }
      throw err;
    }
    const tokens = await this.tokens.issueRegisteredTokens(identity.id);
    return { identityId: identity.id, tokens, redirectTarget };
  }

  private googleConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_REDIRECT_URI } = this.config;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !OAUTH_REDIRECT_URI) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_NOT_CONFIGURED, 'google oauth not configured');
    }
    return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: OAUTH_REDIRECT_URI };
  }

  private validateRedirect(target?: string): string {
    if (target === undefined) {
      const fallback = this.config.OAUTH_REDIRECT_ALLOWLIST[0];
      if (!fallback) {
        throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_NOT_CONFIGURED, 'redirect allowlist empty');
      }
      return fallback;
    }
    if (!this.config.OAUTH_REDIRECT_ALLOWLIST.includes(target)) {
      throw new OAuthError(OAUTH_ERROR_CODES.OAUTH_REDIRECT_INVALID, 'redirect target not in allowlist');
    }
    return target;
  }
}
