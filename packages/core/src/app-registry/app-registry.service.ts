import { Inject, Injectable } from '@nestjs/common';
import type { AppManifest } from '@mymozhem/sdk';
import { buildAppRegistry, type AppRegistry } from './app-registry';
import { APP_MANIFESTS } from './app-registry.tokens';

@Injectable()
export class AppRegistryService {
  private readonly registry: AppRegistry;

  constructor(@Inject(APP_MANIFESTS) manifests: readonly unknown[]) {
    // Built once at construction (boot); immutable thereafter (REQ-CORE-004). A bad
    // manifest throws here and fails startup — fail-closed.
    this.registry = buildAppRegistry(manifests);
  }

  getManifest(appId: string, manifestVersion: number): AppManifest | undefined {
    return this.registry.getManifest(appId, manifestVersion);
  }
}
