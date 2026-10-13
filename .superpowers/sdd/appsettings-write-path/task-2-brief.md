### Task 2: Валидация настроек в AppRegistryService (ajv + кэш, REQ-CORE-007)

**Files:**
- Modify: `packages/core/package.json` (зависимость ajv — через pnpm add)
- Create: `packages/core/src/app-registry/app-registry.errors.ts`
- Modify: `packages/core/src/app-registry/app-registry.service.ts`
- Test: `packages/core/src/app-registry/app-registry.service.spec.ts` (новый describe)

**Interfaces:**
- Consumes: `validManifests` из `@mymozhem/sdk` (quiz@1: appSettings требует `{ title: string, correctAnswers: number[] }`, `additionalProperties: false`).
- Produces: `AppRegistryService.validateSettings(appId: string, manifestVersion: number, settings: unknown): void`; классы `AppRegistryError`, `AppManifestUnknownError`, `AppSettingsInvalidError` с кодами `APP_MANIFEST_UNKNOWN` / `APP_SETTINGS_INVALID` — их используют Tasks 3–4.

- [ ] **Step 1: Установить ajv**

Run: `pnpm --filter @mymozhem/core add ajv@^8.17.1`
Expected: в `packages/core/package.json` появился ajv; lockfile обновлён (один lockfile на монорепо, REQ-DEV-002).

- [ ] **Step 2: Написать failing unit-тесты**

Добавить в `packages/core/src/app-registry/app-registry.service.spec.ts` импорты и describe:

```ts
import Ajv2020 from 'ajv/dist/2020';
import { AppManifestUnknownError, AppSettingsInvalidError } from './app-registry.errors';

// Синхронный catch-helper: validateSettings бросает, не возвращает промис.
const capture = (fn: () => void): unknown => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
};

describe('AppRegistryService.validateSettings (REQ-CORE-007)', () => {
  const manifest = validManifests[0]; // quiz@1: { title: string, correctAnswers: number[] }, additionalProperties: false

  it('accepts settings that satisfy the manifest schema', () => {
    const svc = new AppRegistryService([manifest]);
    expect(() =>
      svc.validateSettings('quiz', 1, { title: 'Friday quiz', correctAnswers: [0, 2] }),
    ).not.toThrow();
  });

  it.each([
    { name: 'missing required property', value: { title: 'Friday quiz' } },
    { name: 'wrong property type', value: { title: 'Friday quiz', correctAnswers: 'nope' } },
    { name: 'additional property', value: { title: 'Friday quiz', correctAnswers: [0], hack: true } },
  ])('rejects invalid settings with APP_SETTINGS_INVALID ($name)', ({ value }) => {
    const svc = new AppRegistryService([manifest]);
    const err = capture(() => svc.validateSettings('quiz', 1, value));
    expect(err).toBeInstanceOf(AppSettingsInvalidError);
    expect((err as AppSettingsInvalidError).code).toBe('APP_SETTINGS_INVALID');
  });

  it.each([
    { name: 'unknown appId', appId: 'nope', version: 1 },
    { name: 'unknown manifestVersion', appId: 'quiz', version: 99 },
  ])('rejects an unknown manifest with APP_MANIFEST_UNKNOWN ($name)', ({ appId, version }) => {
    const svc = new AppRegistryService([manifest]);
    const err = capture(() =>
      svc.validateSettings(appId, version, { title: 't', correctAnswers: [] }),
    );
    expect(err).toBeInstanceOf(AppManifestUnknownError);
    expect((err as AppManifestUnknownError).code).toBe('APP_MANIFEST_UNKNOWN');
  });

  it('compiles the validator once per (appId, manifestVersion) key', () => {
    const spy = jest.spyOn(Ajv2020.prototype, 'compile');
    try {
      const svc = new AppRegistryService([manifest]);
      svc.validateSettings('quiz', 1, { title: 'a', correctAnswers: [] });
      svc.validateSettings('quiz', 1, { title: 'b', correctAnswers: [1] });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
```

- [ ] **Step 3: Прогнать — подтвердить RED**

Run: `pnpm --filter @mymozhem/core test -- app-registry.service`
Expected: FAIL компиляции — `validateSettings does not exist` / `app-registry.errors` не найден.

- [ ] **Step 4: Создать app-registry.errors.ts**

```ts
// Core-internal typed errors of the app-registry module: validation of appSettings
// against the manifest's JSON Schema (REQ-CORE-007). NOT part of the SDK contract —
// when a transport lands, these map to typed API responses without stack traces
// (REQ-SEC-006), same convention as room.errors.ts.
export const APP_REGISTRY_ERROR_CODES = {
  APP_MANIFEST_UNKNOWN: 'APP_MANIFEST_UNKNOWN',
  APP_SETTINGS_INVALID: 'APP_SETTINGS_INVALID',
} as const;

export type AppRegistryErrorCode =
  (typeof APP_REGISTRY_ERROR_CODES)[keyof typeof APP_REGISTRY_ERROR_CODES];

export class AppRegistryError extends Error {
  constructor(
    readonly code: AppRegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

// No manifest registered under (appId, manifestVersion): unknown app, or a version a
// redeploy removed from the compiled-in registry (boot-time registry vs durable room
// row, design §5).
export class AppManifestUnknownError extends AppRegistryError {
  constructor(message: string) {
    super(APP_REGISTRY_ERROR_CODES.APP_MANIFEST_UNKNOWN, message);
  }
}

// Settings do not satisfy the manifest's JSON Schema. ajv detail stays in the
// server-side message only; outward goes the code (REQ-SEC-006).
export class AppSettingsInvalidError extends AppRegistryError {
  constructor(message: string) {
    super(APP_REGISTRY_ERROR_CODES.APP_SETTINGS_INVALID, message);
  }
}
```

- [ ] **Step 5: Реализовать validateSettings в AppRegistryService**

Полностью заменить `packages/core/src/app-registry/app-registry.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import Ajv2020 from 'ajv/dist/2020';
import type { ValidateFunction } from 'ajv';
import type { AppManifest, JsonSchemaObject } from '@mymozhem/sdk';
import { buildAppRegistry, type AppRegistry } from './app-registry';
import { APP_MANIFESTS } from './app-registry.tokens';
import { AppManifestUnknownError, AppSettingsInvalidError } from './app-registry.errors';

@Injectable()
export class AppRegistryService {
  private readonly registry: AppRegistry;
  // REQ-CORE-007: скомпилированные валидаторы кэшируются по (appId, manifestVersion).
  // Лениво — компиляция при первом обращении; далее запись неизменяема (дух
  // REQ-CORE-004, как сам boot-time реестр). Eager-прогрев всех манифестов на буте
  // отклонён: платили бы за неиспользуемое (design §3).
  private readonly validators = new Map<string, ValidateFunction>();
  // Ajv2020: манифестные схемы несут $schema draft 2020-12 — дефолтный Ajv (draft-07)
  // на них падает. strict: false — схемы несут аннотацию x-visibility (ADR-008),
  // неизвестный ajv keyword, который strict-режим отклонил бы.
  private readonly ajv = new Ajv2020({ allErrors: true, strict: false });

  constructor(@Inject(APP_MANIFESTS) manifests: readonly unknown[]) {
    // Built once at construction (boot); immutable thereafter (REQ-CORE-004). A bad
    // manifest throws here and fails startup — fail-closed.
    this.registry = buildAppRegistry(manifests);
  }

  getManifest(appId: string, manifestVersion: number): AppManifest | undefined {
    return this.registry.getManifest(appId, manifestVersion);
  }

  // REQ-CORE-007: валидация настроек по JSON Schema манифеста — при каждой записи
  // (RoomService.configure) и повторно при DRAFT → ACTIVE (RoomService.transition).
  // Verdict-only: никакой коэрсии и мутации входа (ajv без coerce/removeAdditional).
  validateSettings(appId: string, manifestVersion: number, settings: unknown): void {
    const manifest = this.registry.getManifest(appId, manifestVersion);
    if (!manifest) {
      throw new AppManifestUnknownError(
        `No manifest registered for ${appId}@${manifestVersion}`,
      );
    }
    const validate = this.validatorFor(appId, manifestVersion, manifest.appSettings);
    if (!validate(settings)) {
      throw new AppSettingsInvalidError(
        `appSettings do not match the manifest schema of ${appId}@${manifestVersion}: ${this.ajv.errorsText(validate.errors)}`,
      );
    }
  }

  private validatorFor(
    appId: string,
    manifestVersion: number,
    schema: JsonSchemaObject,
  ): ValidateFunction {
    const key = `${appId}@${manifestVersion}`;
    const cached = this.validators.get(key);
    if (cached) {
      return cached;
    }
    const compiled = this.ajv.compile(schema);
    this.validators.set(key, compiled);
    return compiled;
  }
}
```

- [ ] **Step 6: Прогнать — GREEN + гейты задачи**

Run: `pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core lint && pnpm --filter @mymozhem/core typecheck`
Expected: unit PASS (старые 3 + новые 7 в этом файле, остальные без изменений), lint/typecheck чисто.

- [ ] **Step 7: Commit**

```bash
git add packages/core/package.json packages/core/src/app-registry pnpm-lock.yaml
git commit -m "feat(core): AppRegistryService.validateSettings with ajv cache (REQ-CORE-007)"
```

---

