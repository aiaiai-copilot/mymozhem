import { Module, type DynamicModule } from '@nestjs/common';
import { AppRegistryService } from './app-registry.service';
import { APP_MANIFESTS } from './app-registry.tokens';

// Seam фазы 2 (design 2026-09-09 §2): манифесты задаёт composition root, модуль —
// global, чтобы Room/Realtime не импортировали сконфигурированный инстанс повторно.
// Статический импорт AppRegistryModule (без register) — ошибка сборки DI: провайдера
// APP_MANIFESTS в нём больше нет.
@Module({})
export class AppRegistryModule {
  static register(manifests: readonly unknown[]): DynamicModule {
    return {
      module: AppRegistryModule,
      global: true,
      providers: [{ provide: APP_MANIFESTS, useValue: manifests }, AppRegistryService],
      exports: [AppRegistryService],
    };
  }
}
