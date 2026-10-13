# Task 2 Report: Валидация настроек в AppRegistryService (ajv + кэш, REQ-CORE-007)

**Status:** DONE
**Commit:** `4fe39b4 feat(core): AppRegistryService.validateSettings with ajv cache (REQ-CORE-007)` (branch `phase-1-appsettings-write-path`)

## What was implemented

- `AppRegistryService.validateSettings(appId, manifestVersion, settings): void` — verdict-only валидация настроек по JSON Schema манифеста.
- Ленивый кэш скомпилированных ajv-валидаторов по ключу `appId@manifestVersion` (`validatorFor`), компиляция один раз на ключ.
- `Ajv2020` (`ajv/dist/2020`, `{ allErrors: true, strict: false }`) — манифестные схемы несут `$schema: draft 2020-12` и аннотацию `x-visibility`, поэтому draft-07 Ajv и strict-режим непригодны.
- Typed errors в `app-registry.errors.ts`: `AppRegistryError` (base, `code` + `name = new.target.name`), `AppManifestUnknownError` (`APP_MANIFEST_UNKNOWN`), `AppSettingsInvalidError` (`APP_SETTINGS_INVALID`), константа `APP_REGISTRY_ERROR_CODES` — по конвенции `room.errors.ts`.
- Зависимость `ajv` установлена только в `@mymozhem/core` (`^8.20.0`, удовлетворяет `^8.17.1` из брифа); SDK остался чистым zod; lockfile обновлён и закоммичен (REQ-DEV-002).

Весь код — verbatim из брифа (тесты, errors, service, commit message).

## What was tested and results

- `pnpm --filter @mymozhem/core test` — 5 suites, **62 passed** (в `app-registry.service.spec.ts`: 3 старых + 7 новых, как ожидал бриф).
- `pnpm --filter @mymozhem/core lint` — чисто.
- `pnpm --filter @mymozhem/core typecheck` — чисто.

Покрытые сценарии: валидные настройки принимаются; missing required / wrong type / additional property → `AppSettingsInvalidError` с кодом `APP_SETTINGS_INVALID`; unknown appId / unknown manifestVersion → `AppManifestUnknownError` с кодом `APP_MANIFEST_UNKNOWN`; spy на `Ajv2020.prototype.compile` подтверждает одну компиляцию на ключ при двух вызовах.

## TDD Evidence

### RED

- Command: `pnpm --filter @mymozhem/core test -- app-registry.service`
- Output: `error TS2339: Property 'validateSettings' does not exist on type 'AppRegistryService'` (4 вхождения) + нерезолвящийся импорт `./app-registry.errors`; `Test Suites: 1 failed`, exit 1.
- Expected: implementation (`validateSettings`, errors-модуль) ещё не существовала — компилирующийся failing test невозможен, RED зафиксирован как compile failure.

### GREEN

- Command: `pnpm --filter @mymozhem/core test`
- Output: `Test Suites: 5 passed, 5 total; Tests: 62 passed, 62 total` (включая `PASS src/app-registry/app-registry.service.spec.ts`).

## Files changed (commit 4fe39b4)

- `packages/core/package.json` — +`ajv: ^8.20.0`
- `pnpm-lock.yaml` — lockfile под ajv
- `packages/core/src/app-registry/app-registry.errors.ts` — новый (typed errors)
- `packages/core/src/app-registry/app-registry.service.ts` — +`validateSettings`, кэш валидаторов, Ajv2020
- `packages/core/src/app-registry/app-registry.service.spec.ts` — новый describe (7 тестов)

## Self-review findings

- Полнота: все шаги 1–7 брифа выполнены; код verbatim; REQ-CORE-007 закрыт на уровне app-registry. Интерфейс (`validateSettings` + классы ошибок с кодами) совпадает с тем, что ждут Tasks 3–4.
- Дисциплина: ajv только в core; SDK не тронут; один lockfile; никаких новых директорий/заделов; session artifacts не создавались вне `.superpowers/`.
- Замечаний к качеству нет: verdict-only (без коэрсии/мутации входа), ленивая компиляция, immutable-after-write кэш — соответствует REQ-CORE-004 по духу; ajv-детали остаются в server-side message, наружу код (REQ-SEC-006).

## Issues / concerns

- Нет. Отклонение от брифа одно и ожидаемое: pnpm разрешил `ajv@^8.17.1` в `^8.20.0` (semver-совместимо).
