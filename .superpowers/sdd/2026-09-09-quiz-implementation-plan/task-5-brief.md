### Task 5: core — seams реестра в composition root

**Files:**
- Modify: `packages/core/src/app-registry/app-registry.module.ts` — `AppRegistryModule.register(manifests)`, `global: true`
- Modify: `packages/core/src/room/room.module.ts`, `packages/core/src/realtime/realtime.module.ts` — убрать статический импорт `AppRegistryModule` (разрешение через global)
- Modify: `apps/server/src/app.module.ts` — `AppRegistryModule.register([])` (пусто до Task 12)
- Modify: `packages/core/src/index.ts` — экспорт токена уже есть; убедиться что `AppRegistryModule` экспортируется

**Interfaces:**
- Consumes: ничего нового.
- Produces: `AppRegistryModule.register(manifests: readonly unknown[]): DynamicModule` — Task 12 передаёт манифест квиза. `.overrideProvider(APP_MANIFESTS)` в существующих e2e продолжает работать (dynamic module provider переопределяется тем же API).

**Почему global:** RealtimeModule и RoomModule инжектят `AppRegistryService`; если провайдер манифестов задаёт composition root, модуль реестра обязан быть global-динамическим, иначе статический импорт без конфигурации инстанцирует сервис без провайдера `APP_MANIFESTS`.

- [ ] **Step 1: Failing test**

`packages/core/src/app-registry/app-registry.module.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { AppRegistryModule } from './app-registry.module';
import { AppRegistryService } from './app-registry.service';

describe('AppRegistryModule.register', () => {
  it('provides the registry from composition-root manifests', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppRegistryModule.register([])] }).compile();
    expect(moduleRef.get(AppRegistryService)).toBeInstanceOf(AppRegistryService);
  });

  it('fails closed on an invalid manifest at boot', async () => {
    await expect(
      Test.createTestingModule({ imports: [AppRegistryModule.register([{ appId: 'core' }])] }).compile(),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test -- app-registry.module`
Expected: FAIL (register не существует).

- [ ] **Step 3: Implement**

`app-registry.module.ts`:

```typescript
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
```

В `room.module.ts` и `realtime.module.ts` удалить `AppRegistryModule` из `imports` (и импорт символа). В `apps/server/src/app.module.ts` — `AppRegistryModule.register([])` вместо `AppRegistryModule`. Прогнать `grep -rn "AppRegistryModule" packages apps --include="*.ts" | grep -v dist | grep -v spec` и убрать оставшиеся статические импорты.

- [ ] **Step 4: Run — GREEN**

Run: `pnpm build && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/server test`
Expected: PASS (e2e с `overrideProvider(APP_MANIFESTS)` зелёные без изменений).

- [ ] **Step 5: Commit**

```bash
git add packages apps
git commit -m "refactor(core): APP_MANIFESTS-seam в composition root — AppRegistryModule.register, global (design 2026-09-09 §2)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

