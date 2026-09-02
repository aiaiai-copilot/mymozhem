import type { AppConfig } from '../config/config.schema';
import { TEST_CONFIG } from '../testing/test-config';
import { GoogleOAuthClient } from './google-oauth.client';
import { OAuthError, OAUTH_ERROR_CODES } from './oauth.errors';

const OAUTH_CONFIG: AppConfig = {
  ...TEST_CONFIG,
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  OAUTH_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
  OAUTH_REDIRECT_ALLOWLIST: ['http://localhost:3000/app'],
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('GoogleOAuthClient (REQ-ID-015)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exchanges the code at the token endpoint, then fetches userinfo with the bearer token', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ access_token: 'at' }))
      .mockResolvedValueOnce(
        jsonResponse({ sub: 'sub-1', email: 'alex@example.com', email_verified: true, name: 'Alex' }),
      );
    const client = new GoogleOAuthClient(OAUTH_CONFIG);

    const profile = await client.exchangeCode('c', 'v');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    expect(tokenInit.method).toBe('POST');
    const body = tokenInit.body as URLSearchParams;
    expect(body.get('code')).toBe('c');
    expect(body.get('code_verifier')).toBe('v');
    expect(body.get('client_id')).toBe('test-client-id');
    expect(body.get('client_secret')).toBe('test-client-secret');
    expect(body.get('redirect_uri')).toBe('http://localhost:3000/auth/google/callback');
    expect(body.get('grant_type')).toBe('authorization_code');

    const [infoUrl, infoInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(infoUrl).toBe('https://openidconnect.googleapis.com/v1/userinfo');
    expect((infoInit.headers as Record<string, string>).authorization).toBe('Bearer at');

    expect(profile).toEqual({ subject: 'sub-1', email: 'alex@example.com', emailVerified: true, displayName: 'Alex' });
  });

  it('throws when the token endpoint responds not-ok', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400));
    const client = new GoogleOAuthClient(OAUTH_CONFIG);
    await expect(client.exchangeCode('c', 'v')).rejects.toThrow('google token endpoint: 400');
  });

  it('defaults a missing email_verified claim to false (fail-closed)', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ access_token: 'at' }))
      .mockResolvedValueOnce(jsonResponse({ sub: 'sub-1', email: 'alex@example.com', name: 'Alex' }));
    const client = new GoogleOAuthClient(OAUTH_CONFIG);

    const profile = await client.exchangeCode('c', 'v');
    expect(profile.emailVerified).toBe(false);
  });

  it('throws OAUTH_NOT_CONFIGURED without the Google section', async () => {
    const client = new GoogleOAuthClient(TEST_CONFIG);
    let caught: unknown;
    try {
      await client.exchangeCode('c', 'v');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    expect((caught as OAuthError).code).toBe(OAUTH_ERROR_CODES.OAUTH_NOT_CONFIGURED);
  });
});
