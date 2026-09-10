export * from './config/config.schema';
export * from './config/config.tokens';
export * from './config/config.module';
export * from './prisma/prisma.service';
export * from './prisma/prisma.module';
export * from './health/health.controller';
export * from './health/health.module';
export * from './app-registry/app-registry';
export * from './app-registry/app-registry.tokens';
export * from './app-registry/app-registry.service';
export * from './app-registry/app-registry.module';
export * from './app-runtime/app-runtime.tokens';
export * from './app-runtime/app-runtime.errors';
export * from './app-runtime/room-serializer';
export * from './app-runtime/app-projection-cache';
export * from './app-runtime/app-runtime.service';
export * from './app-runtime/app-runtime.module';
export * from './room/room.errors';
export * from './room/room-state-machine';
export * from './room/room.service';
export * from './room/room.module';
export * from './identity/identity.service';
export * from './identity/identity.module';
export * from './membership/membership.errors';
export * from './membership/join-rate-limiter';
export * from './membership/membership.service';
export * from './membership/membership.module';
export * from './realtime/event-log.service';
export * from './realtime/event-emit-limiter';
export * from './realtime/realtime.errors';
// Срез исключения: membership.errors тоже экспортирует ActorNotMemberError
// (MembershipError-подкласс, design 2026-08-18 §«Гейт актора») — star-export двух
// модулей даёт TS2308. Явный re-export снимает неоднозначность в пользу realtime-
// версии (status quo barrel); membership-версия потребляется по прямому пути модуля.
export { ActorNotMemberError } from './realtime/realtime.errors';
export * from './realtime/realtime.module';
export * from './realtime/realtime-bus';
export * from './realtime/event-outbox';
export * from './realtime/projection.service';
export * from './realtime/subscription-registry';
export * from './realtime/realtime.tokens';
export * from './realtime/error-mapping';
export * from './realtime/io-adapter';
export * from './realtime/realtime.gateway';
export * from './auth/auth.constants';
export * from './auth/auth.errors';
export * from './auth/token.service';
export * from './auth/auth.module';
export * from './oauth/oauth.constants';
export * from './oauth/oauth.errors';
export { OAUTH_PROVIDER_CLIENT } from './oauth/oauth-provider.client';
export type { OAuthProviderClient, ProviderProfile } from './oauth/oauth-provider.client';
export * from './oauth/oauth.module';
export * from './transport/transport.module';
export * from './transport/http-exception.filter';
export * from './transport/auth.tokens';
// Testing harness — осознанное расширение barrel (design §9): e2e-спеки apps/server
// строятся на том же testcontainer-посеве, что и core int-спеки.
export * from './testing/postgres.testcontainer';
export * from './testing/seed-identity';
export * from './testing/test-config';
