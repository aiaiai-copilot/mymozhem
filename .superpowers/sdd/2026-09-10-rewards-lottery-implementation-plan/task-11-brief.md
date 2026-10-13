### Task 11: Composition root + boundary-правило rewards + lint Math.random + guardrails

**Files:**
- Modify: `packages/core/src/rewards/rewards.module.ts` (@Global, AWARD_EFFECT_HANDLER провайдер)
- Modify: `apps/server/src/app.module.ts` (регистрация rewards/lottery/quiz@2, расписание)
- Create: `apps/server/src/anonymization-guards.module.ts`
- Modify: `apps/server/package.json` (deps: `@mymozhem/app-lottery`, `@nestjs/schedule`)
- Modify: `.dependency-cruiser.cjs` (правило rewards)
- Modify: `scripts/verify-guardrails.mjs` (probe нового правила + probe eslint-правила)
- Modify: `eslint.config.js` (запрет Math.random в packages/app-*)
- Test: прогон существующих e2e (boot AppModule — валидация DI-связки)

**Interfaces:**
- Consumes: всё предыдущее. `createQuizApp()`/`createLotteryApp()`, `RewardsModule`, `IdentitySweepModule`, `ANONYMIZATION_GUARDS`, `RewardsAnonymizationGuard`, `AWARD_EFFECT_HANDLER`.
- Produces: работающая сборка всей фазы; машинное принуждение REQ-RWD-001 (boundary) и REQ-RWD-011 (lint).

**REQ:** REQ-RWD-001 (boundary + DI-токены), REQ-RWD-011 (lint-запрет — решение владельца 2026-09-10), REQ-DEV-001 (границы принуждаются машиной), REQ-RT-004 (реестр по пинам).

- [ ] **Step 1: Failing guardrail — boundary-правило rewards**

`scripts/verify-guardrails.mjs`: добавить probe по существующему паттерну («writeFileSync probe-файла + expectFailure(depcruise …)» + cleanup): probe `packages/core/src/room/__probe-rewards-boundary.ts` с `import '@mymozhem/core/src/rewards/rewards.module'` — ожидается отказ depcruise. (Точную форму expectFailure скопировать из соседнего probe `app-only-through-sdk` в том же файле.)

Run: `pnpm guardrails` → FAIL (правила ещё нет — probe проходит насквозь).

- [ ] **Step 2: Failing guardrail — eslint Math.random**

В `verify-guardrails.mjs` второй probe: записать `packages/app-quiz/src/__probe-math-random.ts` с `export const x = Math.random();`, запустить `eslint` на него, ожидать error; cleanup. Run: `pnpm guardrails` → FAIL.

(Если verify-guardrails сегодня знает только depcruise — добавить запуск eslint тем же expectFailure-хелпером с командой `pnpm exec eslint <file>`; форму зафиксировать в леджере.)

- [ ] **Step 3: Implement — правила**

`.dependency-cruiser.cjs`, в `forbidden` (форма — по прецеденту `socketio-only-in-realtime`):

```javascript
  {
    name: 'rewards-only-through-di-tokens',
    comment:
      'Ядро не зависит от rewards (REQ-RWD-001): связка — DI-токены AWARD_EFFECT_HANDLER ' +
      '(app-runtime/effects) и ANONYMIZATION_GUARDS (identity); единственные точки, ' +
      'импортирующие core/rewards, — barrel index.ts и сам модуль rewards.',
    severity: 'error',
    from: {
      path: '^packages/core/src',
      pathNot: ['^packages/core/src/rewards', '^packages/core/src/index\\.ts$'],
    },
    to: { path: '^packages/core/src/rewards' },
  },
```

`eslint.config.js`, добавить блок в конфиг:

```javascript
  {
    // REQ-RWD-011 (решение владельца 2026-09-10): случайность app-модулей —
    // только ctx.randomInt (CSPRNG хоста); Math.random отсекается машиной.
    files: ['packages/app-*/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'Случайность app-модулей — только ctx.randomInt (CSPRNG хоста, REQ-RWD-011).',
        },
      ],
    },
  },
```

Run: `pnpm guardrails && pnpm lint && pnpm boundary-check` → GREEN (probe отказываются насквозь-проходить; реальных нарушений нет — лотерея/квиз Math.random не используют).

- [ ] **Step 4: Implement — RewardsModule @Global + handler**

`rewards.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { AWARD_EFFECT_HANDLER } from '../app-runtime/effects';
// ... прочие импорты как были

// @Global: AppRuntimeService (AppRuntimeModule, global) опционально инжектирует
// AWARD_EFFECT_HANDLER; identity-свип — ANONYMIZATION_GUARDS из composition root
// (apps/server/src/anonymization-guards.module.ts). Ядро rewards не импортирует
// (boundary rewards-only-through-di-tokens).
@Global()
@Module({
  imports: [PrismaModule, MembershipModule, RealtimeModule, AuthModule],
  controllers: [RewardsController],
  providers: [
    RewardsService,
    RewardsAnonymizationGuard,
    { provide: AWARD_EFFECT_HANDLER, useExisting: RewardsService },
  ],
  exports: [RewardsService, RewardsAnonymizationGuard, AWARD_EFFECT_HANDLER],
})
export class RewardsModule {}
```

Примечание: `RewardsService` при этом должен удовлетворять `AwardEffectHandler` — сигнатура `executeEffects(tx, roomId, sourceAppId, effects)` уже совместима (Task 5); добавить `implements AwardEffectHandler` в объявление класса (импорт типа из `../app-runtime/effects` — разрешённое направление: rewards → app-runtime/effects).

- [ ] **Step 5: Implement — composition root**

`apps/server/src/anonymization-guards.module.ts`:

```typescript
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
```

`apps/server/src/app.module.ts` — целиком:

```typescript
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { createQuizApp } from '@mymozhem/app-quiz';
import { createLotteryApp } from '@mymozhem/app-lottery';
import {
  AppRegistryModule,
  AppRuntimeModule,
  HealthModule,
  IdentityModule,
  IdentitySweepModule,
  MembershipModule,
  PrismaModule,
  RealtimeModule,
  RewardsModule,
  RoomModule,
  TransportModule,
} from '@mymozhem/core';
import { AnonymizationGuardsModule } from './anonymization-guards.module';

const quiz = createQuizApp();
const lottery = createLotteryApp();

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    ScheduleModule.forRoot(), // REQ-ID-010: регламентные джобы; одна реплика (REQ-OPS-005)
    AppRegistryModule.register([quiz.manifest, lottery.manifest]),
    AppRuntimeModule.register([quiz.runtime, lottery.runtime]),
    RoomModule,
    IdentityModule,
    MembershipModule,
    RealtimeModule,
    TransportModule,
    RewardsModule, // global: AWARD_EFFECT_HANDLER для app-runtime (REQ-RWD-001)
    IdentitySweepModule, // TTL-свип гостей (REQ-ID-003/014) с приостановкой (REQ-RWD-013)
    AnonymizationGuardsModule,
  ],
})
export class AppModule {}
```

`apps/server/package.json` deps += `"@mymozhem/app-lottery": "workspace:*"`, `"@nestjs/schedule": "<та же линейка, что в core>"`; `pnpm install`.

- [ ] **Step 6: Run — GREEN (boot-валидация DI через существующие e2e)**

Run: `pnpm install && pnpm build && pnpm lint && pnpm boundary-check && pnpm guardrails && pnpm test && pnpm test:int`
Expected: PASS. Ключевой сигнал: `apps/server` e2e (quiz.e2e и др.) boot'ят настоящий AppModule — DI-связка (ScheduleModule → SchedulerRegistry → GuestSweepScheduler; RewardsModule → AWARD_EFFECT_HANDLER → AppRuntimeService; AnonymizationGuardsModule → ANONYMIZATION_GUARDS → GuestSweepService) валидируется контейнером. Quiz.e2e после Task 10 проходит на manifestVersion 2 с effects-исполнителем.

- [ ] **Step 7: Commit**

```bash
git add apps/server packages/core/src/rewards .dependency-cruiser.cjs eslint.config.js scripts/verify-guardrails.mjs pnpm-lock.yaml
git commit -m "feat(server,core): composition root фазы 3 — RewardsModule, лотерея+квиз@2, свип; boundary rewards-only-through-di-tokens; lint Math.random

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

