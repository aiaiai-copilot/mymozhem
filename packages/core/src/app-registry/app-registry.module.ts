import { Module } from '@nestjs/common';
import { AppRegistryService } from './app-registry.service';
import { APP_MANIFESTS } from './app-registry.tokens';

@Module({
  providers: [
    // Empty seam: phase-2 app-modules replace this with their manifests (design §5).
    { provide: APP_MANIFESTS, useValue: [] },
    AppRegistryService,
  ],
  exports: [AppRegistryService],
})
export class AppRegistryModule {}
