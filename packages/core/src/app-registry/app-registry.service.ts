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

  // REQ-CTR-008/009 read-path для event-commit цепочки: схема + декларированный
  // потолок видимости типа из манифеста. undefined = неизвестный тип/манифест.
  getEventDefinition(
    appId: string,
    manifestVersion: number,
    name: string,
  ): AppManifest['events'][string] | undefined {
    return this.registry.getManifest(appId, manifestVersion)?.events[name];
  }

  // Валидаторы app-событий — в том же кэше, что appSettings (REQ-CORE-007), с
  // префиксом ключа, чтобы не пересекаться с ключом настроек `appId@version`.
  eventValidatorFor(
    appId: string,
    manifestVersion: number,
    name: string,
    schema: JsonSchemaObject,
  ): ValidateFunction {
    const key = `event:${appId}@${manifestVersion}:${name}`;
    const cached = this.validators.get(key);
    if (cached) {
      return cached;
    }
    const compiled = this.ajv.compile(schema);
    this.validators.set(key, compiled);
    return compiled;
  }

  describeEventErrors(validate: ValidateFunction): string {
    return this.ajv.errorsText(validate.errors);
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
