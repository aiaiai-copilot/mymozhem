import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { IdentityModule } from '../identity/identity.module';
import { AuthModule } from '../auth/auth.module';
import { OAuthService } from './oauth.service';
import { GoogleOAuthClient } from './google-oauth.client';
import { OAUTH_PROVIDER_CLIENT } from './oauth-provider.client';

@Module({
  imports: [ConfigModule, IdentityModule, AuthModule],
  providers: [
    OAuthService,
    GoogleOAuthClient,
    // Порт → Google-реализация; в e2e подменяется override'ом токена (design §9).
    { provide: OAUTH_PROVIDER_CLIENT, useExisting: GoogleOAuthClient },
  ],
  exports: [OAuthService, OAUTH_PROVIDER_CLIENT],
})
export class OAuthModule {}
