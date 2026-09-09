// Та же схема, что AppRegistryModule (Task 5): global + register из composition root.
import { Module, type DynamicModule } from '@nestjs/common';
import { AppRuntimeService } from './app-runtime.service';
import { AppProjectionCache } from './app-projection-cache';
import { APP_RUNTIME_MODULES, type RegisteredRuntimeModules } from './app-runtime.tokens';

@Module({})
export class AppRuntimeModule {
  static register(modules: RegisteredRuntimeModules): DynamicModule {
    return {
      module: AppRuntimeModule,
      global: true,
      providers: [{ provide: APP_RUNTIME_MODULES, useValue: modules }, AppProjectionCache, AppRuntimeService],
      exports: [AppRuntimeService],
    };
  }
}
