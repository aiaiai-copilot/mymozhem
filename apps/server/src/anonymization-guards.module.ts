import { Global, Module } from '@nestjs/common';
import { ANONYMIZATION_GUARDS, RewardsAnonymizationGuard, RewardsModule } from '@mymozhem/core';

// Связка identity ↔ rewards по DI-токену (REQ-RWD-001): identity объявляет токен,
// rewards даёт guard; друг без друга модули не знают. Без RewardsModule массив
// гардов пуст — приостановки TTL нет, свип работает (design §5).
@Global()
@Module({
  imports: [RewardsModule],
  providers: [
    {
      provide: ANONYMIZATION_GUARDS,
      useFactory: (guard: RewardsAnonymizationGuard) => [guard],
      inject: [RewardsAnonymizationGuard],
    },
  ],
  exports: [ANONYMIZATION_GUARDS],
})
export class AnonymizationGuardsModule {}
