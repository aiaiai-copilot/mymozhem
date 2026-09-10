import type { AppRuntimeModule } from '@mymozhem/sdk';

export const APP_RUNTIME_MODULES = Symbol('APP_RUNTIME_MODULES');
export type RegisteredRuntimeModules = readonly AppRuntimeModule[];
