// Та же схема, что AppRegistryModule (Task 5): global + register из composition root.
import { Module, type DynamicModule } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MembershipModule } from '../membership/membership.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AppRuntimeService } from './app-runtime.service';
import { AppProjectionCache } from './app-projection-cache';
import { APP_RUNTIME_MODULES, type RegisteredRuntimeModules } from './app-runtime.tokens';

@Module({})
export class AppRuntimeModule {
  static register(modules: RegisteredRuntimeModules): DynamicModule {
    return {
      module: AppRuntimeModule,
      global: true,
      // Зависимости диспетчера: PrismaService, MembershipService — прямые импорты;
      // EventLogService/EventOutbox — экспорты RealtimeModule (AppRegistryService
      // приходит из global AppRegistryModule). Цикла нет: RealtimeModule НЕ
      // импортирует AppRuntimeModule — gateway разрешает AppRuntimeService через
      // global-провайдер (тот же шов, что APP_MANIFESTS в Task 5).
      imports: [PrismaModule, MembershipModule, RealtimeModule],
      providers: [{ provide: APP_RUNTIME_MODULES, useValue: modules }, AppProjectionCache, AppRuntimeService],
      exports: [AppRuntimeService],
    };
  }
}
