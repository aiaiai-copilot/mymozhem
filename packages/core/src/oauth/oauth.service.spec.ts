import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../config/config.schema';
import { TEST_CONFIG } from '../testing/test-config';
import { IdentityError, IDENTITY_ERROR_CODES } from '../identity/identity.errors';
import { OAuthService } from './oauth.service';
import { OAuthError, OAUTH_ERROR_CODES } from './oauth.errors';
import { OAUTH_PKCE_COOKIE, OAUTH_REDIRECT_COOKIE, OAUTH_STATE_COOKIE } from './oauth.constants';

const OAUTH_CONFIG: AppConfig = {
  ...TEST_CONFIG,
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  OAUTH_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
  OAUTH_REDIRECT_ALLOWLIST: ['http://localhost:3000/app', 'http://localhost:3000/other'],
};

const makeService = (config: AppConfig = OAUTH_CONFIG) => {
  const providerFake = { exchangeCode: jest.fn() };
  const identityFake = { findOrCreateByProvider: jest.fn() };
  const tokensFake = {
    issueRegisteredTokens: jest
      .fn()
      .mockResolvedValue({ accessToken: 'a', expiresIn: 900, refreshToken: 'r', kind: 'REGISTERED' }),
  };
  const service = new OAuthService(identityFake as never, tokensFake as never, providerFake as never, config);
  return { service, providerFake, identityFake, tokensFake };
};

const cookieValue = (cookies: { name: string; value: string }[], name: string): string => {
  const found = cookies.find((c) => c.name === name);
  expect(found).toBeDefined();
  return found!.value;
};

describe('OAuthService.start (REQ-ID-015/009)', () => {
  it('builds the Google authorize URL with state double-submit and PKCE S256 cookies', () => {
    const { service } = makeService();
    const { authorizeUrl, cookies } = service.start('http://localhost:3000/app');

    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/google/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    const stateCookie = cookieValue(cookies, OAUTH_STATE_COOKIE);
    expect(url.searchParams.get('state')).toBe(stateCookie);

    const verifier = cookieValue(cookies, OAUTH_PKCE_COOKIE);
    const expectedChallenge = createHash('sha256').update(verifier).digest('base64url');
    expect(url.searchParams.get('code_challenge')).toBe(expectedChallenge);

    expect(cookieValue(cookies, OAUTH_REDIRECT_COOKIE)).toBe('http://localhost:3000/app');
  });

  it('falls back to the first allowlist entry when redirect is absent', () => {
    const { service } = makeService();
    const { cookies } = service.start();
    expect(cookieValue(cookies, OAUTH_REDIRECT_COOKIE)).toBe('http://localhost:3000/app');
  });

  it('rejects a redirect outside the allowlist', () => {
    const { service } = makeService();
    let caught: unknown;
    try {
      service.start('https://evil.example.com/steal');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    expect((caught as OAuthError).code).toBe(OAUTH_ERROR_CODES.OAUTH_REDIRECT_INVALID);
  });

  it('throws OAUTH_NOT_CONFIGURED without the Google section (TEST_CONFIG as-is)', () => {
    const { service } = makeService(TEST_CONFIG);
    let caught: unknown;
    try {
      service.start();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    expect((caught as OAuthError).code).toBe(OAUTH_ERROR_CODES.OAUTH_NOT_CONFIGURED);
  });
});

describe('OAuthService.complete (REQ-ID-015/009)', () => {
  const happyCookies = {
    [OAUTH_STATE_COOKIE]: 'S',
    [OAUTH_PKCE_COOKIE]: 'V',
    [OAUTH_REDIRECT_COOKIE]: 'http://localhost:3000/other',
  };
  const happyProfile = { subject: 'sub', email: 'a@b.c', emailVerified: true, displayName: 'Alex' };

  const expectOAuthError = async (promise: Promise<unknown>, code: string): Promise<void> => {
    let caught: unknown;
    try {
      await promise;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    expect((caught as OAuthError).code).toBe(code);
  };

  it('happy path: exchanges code with the PKCE verifier, provisions identity, issues tokens', async () => {
    const { service, providerFake, identityFake, tokensFake } = makeService();
    providerFake.exchangeCode.mockResolvedValue(happyProfile);
    identityFake.findOrCreateByProvider.mockResolvedValue({ id: 'ident-1' });

    const result = await service.complete({ code: 'c', state: 'S', cookies: happyCookies });

    expect(providerFake.exchangeCode).toHaveBeenCalledWith('c', 'V');
    expect(identityFake.findOrCreateByProvider).toHaveBeenCalledWith({
      provider: 'google',
      subject: 'sub',
      email: 'a@b.c',
      displayName: 'Alex',
    });
    expect(tokensFake.issueRegisteredTokens).toHaveBeenCalledWith('ident-1');
    expect(result.identityId).toBe('ident-1');
    expect(result.tokens).toEqual({ accessToken: 'a', expiresIn: 900, refreshToken: 'r', kind: 'REGISTERED' });
    expect(result.redirectTarget).toBe('http://localhost:3000/other');
  });

  it('maps provider error=access_denied to OAUTH_ACCESS_DENIED', async () => {
    const { service } = makeService();
    await expectOAuthError(
      service.complete({ error: 'access_denied', cookies: happyCookies }),
      OAUTH_ERROR_CODES.OAUTH_ACCESS_DENIED,
    );
  });

  it('rejects when state does not match the cookie', async () => {
    const { service } = makeService();
    await expectOAuthError(
      service.complete({ code: 'c', state: 'X', cookies: happyCookies }),
      OAUTH_ERROR_CODES.OAUTH_STATE_INVALID,
    );
  });

  it('rejects when the state cookie is absent', async () => {
    const { service } = makeService();
    const cookies = { [OAUTH_PKCE_COOKIE]: 'V', [OAUTH_REDIRECT_COOKIE]: 'http://localhost:3000/other' };
    await expectOAuthError(
      service.complete({ code: 'c', state: 'S', cookies }),
      OAUTH_ERROR_CODES.OAUTH_STATE_INVALID,
    );
  });

  it('rejects when code is absent', async () => {
    const { service } = makeService();
    await expectOAuthError(
      service.complete({ state: 'S', cookies: happyCookies }),
      OAUTH_ERROR_CODES.OAUTH_STATE_INVALID,
    );
  });

  it('rejects when the PKCE cookie is absent', async () => {
    const { service } = makeService();
    const cookies = { [OAUTH_STATE_COOKIE]: 'S', [OAUTH_REDIRECT_COOKIE]: 'http://localhost:3000/other' };
    await expectOAuthError(
      service.complete({ code: 'c', state: 'S', cookies }),
      OAUTH_ERROR_CODES.OAUTH_STATE_INVALID,
    );
  });

  it('re-validates the redirect cookie against the allowlist (cookie is httpOnly but unsigned)', async () => {
    const { service, providerFake } = makeService();
    providerFake.exchangeCode.mockResolvedValue(happyProfile);
    await expectOAuthError(
      service.complete({
        code: 'c',
        state: 'S',
        cookies: { ...happyCookies, [OAUTH_REDIRECT_COOKIE]: 'https://evil.example.com' },
      }),
      OAUTH_ERROR_CODES.OAUTH_REDIRECT_INVALID,
    );
  });

  it('rejects an unverified email fail-closed', async () => {
    const { service, providerFake } = makeService();
    providerFake.exchangeCode.mockResolvedValue({ ...happyProfile, emailVerified: false });
    await expectOAuthError(
      service.complete({ code: 'c', state: 'S', cookies: happyCookies }),
      OAUTH_ERROR_CODES.OAUTH_EMAIL_UNVERIFIED,
    );
  });

  it('wraps a provider failure as OAUTH_EXCHANGE_FAILED (message includes the cause)', async () => {
    const { service, providerFake } = makeService();
    providerFake.exchangeCode.mockRejectedValue(new Error('google 500'));

    let caught: unknown;
    try {
      await service.complete({ code: 'c', state: 'S', cookies: happyCookies });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    expect((caught as OAuthError).code).toBe(OAUTH_ERROR_CODES.OAUTH_EXCHANGE_FAILED);
    expect((caught as OAuthError).message).toContain('code exchange failed: google 500');
  });

  it('wraps a provider ZodError as OAUTH_EXCHANGE_FAILED without dumped issues/PII (REQ-SEC-004)', async () => {
    const { service, providerFake } = makeService();
    const parsed = z.email().safeParse('not-an-email');
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    providerFake.exchangeCode.mockRejectedValue(parsed.error);

    let caught: unknown;
    try {
      await service.complete({ code: 'c', state: 'S', cookies: happyCookies });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    const oauthErr = caught as OAuthError;
    expect(oauthErr.code).toBe(OAUTH_ERROR_CODES.OAUTH_EXCHANGE_FAILED);
    expect(oauthErr.message).toContain('provider response invalid');
    expect(oauthErr.message).not.toContain('not-an-email');
  });

  it('translates IdentityError(EMAIL_CONFLICT) to OAUTH_EMAIL_CONFLICT', async () => {
    const { service, providerFake, identityFake } = makeService();
    providerFake.exchangeCode.mockResolvedValue(happyProfile);
    identityFake.findOrCreateByProvider.mockRejectedValue(
      new IdentityError(IDENTITY_ERROR_CODES.EMAIL_CONFLICT, 'email taken'),
    );
    await expectOAuthError(
      service.complete({ code: 'c', state: 'S', cookies: happyCookies }),
      OAUTH_ERROR_CODES.OAUTH_EMAIL_CONFLICT,
    );
  });

  it('propagates IdentityError(PROVIDER_IDENTITY_GONE) as-is (not wrapped)', async () => {
    const { service, providerFake, identityFake } = makeService();
    providerFake.exchangeCode.mockResolvedValue(happyProfile);
    const gone = new IdentityError(IDENTITY_ERROR_CODES.PROVIDER_IDENTITY_GONE, 'identity deleted');
    identityFake.findOrCreateByProvider.mockRejectedValue(gone);

    let caught: unknown;
    try {
      await service.complete({ code: 'c', state: 'S', cookies: happyCookies });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(gone);
    expect(caught).not.toBeInstanceOf(OAuthError);
  });
});
