# Task 11 — отчёт: composition root фазы 3 + boundary rewards + lint Math.random + guardrails

## Что сделано

1. **Guardrail-probes (RED first)** — `scripts/verify-guardrails.mjs`: два новых probe по существующему паттерну `writeFileSync + expectFailure + cleanup`:
   - `packages/core/src/room/__probe-rewards-boundary.ts` (depcruise) — импорт core/rewards из чужого домена ядра;
   - `packages/app-quiz/src/__probe-math-random.ts` (eslint) — `Math.random()` в app-модуле.
2. **Правило boundary** — `.dependency-cruiser.cjs`, `forbidden`: `rewards-only-through-di-tokens` (verbatim из брифа) + поправка Ruling C-F.1: `from.pathNot` дополнен `'[.]int-spec[.]ts$'` с комментарием (int-spec — миниатюры composition root: guest-sweep.int-spec и app-runtime.int-spec легально собирают RewardsModule/RewardsService).
3. **Правило lint** — `eslint.config.js`: блок `no-restricted-syntax` на `Math.random()` для `packages/app-*/src/**/*.ts` (verbatim из брифа, REQ-RWD-011).
4. **RewardsModule** (`packages/core/src/rewards/rewards.module.ts`): `@Global()`, провайдер `{ provide: AWARD_EFFECT_HANDLER, useExisting: RewardsService }`, экспорт токена; комментарий про DI-шов.
5. **RewardsService** (`rewards.service.ts`): `implements AwardEffectHandler` (import type из `../app-runtime/effects` — разрешённое направление rewards → app-runtime).
6. **Composition root** (`apps/server`):
   - новый `src/anonymization-guards.module.ts` (@Global, фабрика `ANONYMIZATION_GUARDS` из `RewardsAnonymizationGuard`);
   - `src/app.module.ts` переписан целиком по брифу (ScheduleModule.forRoot, quiz@2 + lottery в AppRegistry/AppRuntime, RewardsModule, IdentitySweepModule, AnonymizationGuardsModule);
   - `package.json`: deps += `@mymozhem/app-lottery: workspace:*`, `@nestjs/schedule: ^6.1.3` (линейка как в core); `pnpm install` → lockfile +6 строк.
7. **Фикс жизненного цикла свипа** (`packages/core/src/identity/identity-sweep.module.ts`) — см. «Отклонения».

## RED evidence (до введения правил)

`pnpm guardrails` после добавления probes, до добавления правил:

```
OK   — guardrail fired on: sdk → core import (dependency-cruiser)
OK   — guardrail fired on: module-level mutable export (eslint)
OK   — guardrail fired on: apps → core src-internals import (dependency-cruiser)
FAIL — guardrail did NOT fire on: core domain → rewards import (dependency-cruiser)
FAIL — guardrail did NOT fire on: Math.random in app module (eslint)

Guardrails are NOT enforcing. Fix before merge.
exit=1
```

Оба probe проходили насквозь — правила не существовали. (Промежуточная итерация показала, что пакетный путь `@mymozhem/core/src/…` из брифа depcruise не резолвит и probe ловил `not-to-unresolvable` — см. отклонение 1; после перехода на относительный импорт RED настоящий, как показано выше.)

## GREEN evidence (полный pipeline)

- `pnpm build` — 5/5 successful.
- `pnpm lint` — 5/5 successful.
- `pnpm boundary-check` — `✔ no dependency violations found (619 modules, 1866 dependencies cruised)`.
- `pnpm guardrails`:

```
OK   — guardrail fired on: sdk → core import (dependency-cruiser)
OK   — guardrail fired on: module-level mutable export (eslint)
OK   — guardrail fired on: apps → core src-internals import (dependency-cruiser)
OK   — guardrail fired on: core domain → rewards import (dependency-cruiser)
OK   — guardrail fired on: Math.random in app module (eslint)

All guardrails verified alive.
```

- `pnpm test` — 9/9 задач; ключевой сигнал: `@mymozhem/server` e2e **5/5 suites, 58/58 tests passed** (boot реального AppModule — DI-связка ScheduleModule→SchedulerRegistry→GuestSweepScheduler, RewardsModule→AWARD_EFFECT_HANDLER→AppRuntimeService, AnonymizationGuardsModule→ANONYMIZATION_GUARDS→GuestSweepService валидирована контейнером; quiz.e2e зелёный на manifestVersion 2 с подключённым effects-исполнителем).
- `pnpm test:int` — 5/5 задач; `@mymozhem/core` int: **20/20 suites, 188/188 tests passed**.

## Отклонения от брифа

1. **Probe-импорт: относительный вместо пакетного.** Бриф предписывал `import '@mymozhem/core/src/rewards/rewards.module'` — depcruise такой subpath не резолвит (`@mymozhem/core` имеет `main: dist/index.js`, нет `exports`-мапы на src), probe срабатывал на `not-to-unresolvable` независимо от наличия целевого правила — ложноположительный guardrail. Заменено на относительный `'../rewards/rewards.module'` (с комментарием в коде), RED подтверждён честно. Дополнительно: путь `../../rewards/…` (как в соседнем sdk-probe по форме) из `src/room/` резолвится в `packages/core/rewards/…` — не существует; правильная глубина — один уровень вверх.
2. **Фикс `GuestSweepScheduler.onApplicationShutdown` (не входил в список файлов брифа).** После подключения IdentitySweepModule в AppModule все 5 e2e-suites apps/server упали: `app.close()` дёргает shutdown-хук, но e2e живут через `app.init()` + `app.inject()` без `listen()`, поэтому `onApplicationBootstrap` (регистрация интервала) не отрабатывал, а безусловный `deleteInterval('guest-sweep')` бросал `No Interval was found`. Исправление — идемпотентное снятие через `doesExist('interval', 'guest-sweep')` с комментарием. Это не «замалчивание» падения: поведение в проде (listen → bootstrap → shutdown) не изменилось, тестовый путь перестал падать на несимметрии хуков. Файл добавлен в коммит сверх списка брифа.
3. Остальное — verbatim по брифу (тексты правил, composition root, версия @nestjs/schedule `^6.1.3` из packages/core/package.json).

## Self-review

- Boundary: packages/core вне src/rewards, src/index.ts и int-spec не импортирует core/rewards — подтверждено машинно (`boundary-check` зелёный при активном правиле + probe стреляет). `identity-sweep.module.ts` rewards не импортирует.
- Barrel (`packages/core/src/index.ts`) не тронут — всё нужное уже экспортировано (подтверждено проверкой, controller fact 2).
- `RewardsService.executeEffects(tx, roomId, sourceAppId, effects)` сигнатурно совместим с `AwardEffectHandler` — tsc подтверждает (build зелёный с `implements`).
- `Math.random` в packages/app-*/src не используется (упоминание только в комментарии lottery-handlers.ts — selector смотрит на CallExpression, комментарии не ловит; lint зелёный).
- Никаких новых модулей «про запас»; все изменения — по списку брифа + один обоснованный фикс.
