// Порт OAuth-провайдера (design §2): второй провайдер = новая реализация + данные,
// без изменений схемы/контракта. DI-токен — прецедент REFRESH_RATE_LIMITER.
export interface ProviderProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName?: string | undefined;
}

export interface OAuthProviderClient {
  exchangeCode(code: string, pkceVerifier: string): Promise<ProviderProfile>;
}

export const OAUTH_PROVIDER_CLIENT = Symbol('OAUTH_PROVIDER_CLIENT');
