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
