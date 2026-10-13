### Task 7: app-runtime — исполнение эффектов, capability-гейт, наполнение хост-примитивов

**Files:**
- Create: `packages/core/src/app-runtime/effects.ts` (токен + интерфейс)
- Modify: `packages/core/src/app-runtime/app-runtime.service.ts` (capability-гейт, исполнение эффектов до коммитов, drawPool)
- Modify: `packages/core/src/membership/membership.service.ts` (`listActiveParticipantPool`)
- Modify: `packages/core/src/app-runtime/app-runtime.module.ts` (опциональная инжекция — без правок, если `@Optional()` в сервисе)
- Modify: `packages/core/src/index.ts` (barrel += effects)
- Test: `packages/core/src/app-runtime/app-runtime.int-spec.ts` (существующий — новые кейсы)

**Interfaces:**
- Consumes: `normalizePublishResult`/`appEffectSchema`/`DrawPoolEntry` (Task 3), `RewardsService.executeEffects` (Task 5) — связка только в Task 11, здесь токен и опциональная инжекция.
- Produces:
  - `AWARD_EFFECT_HANDLER: symbol` и `interface AwardEffectHandler { executeEffects(tx: Prisma.TransactionClient, roomId: string, sourceAppId: string, effects: readonly AppEffect[]): Promise<void> }` — обьявлены в `core/src/app-runtime/effects.ts`; реализует RewardsService (Task 5 сигнатура совместима), подключает composition root (Task 11).
  - `MembershipService.listActiveParticipantPool(roomId): Promise<DrawPoolEntry[]>`.
  - Диспетчер: эффекты при отсутствии capability/'rewards' или исполнителя → `CAPABILITY_UNAVAILABLE` до исполнения; эффекты исполняются в `outbox.run` ДО коммитов; `ctx.drawPool` наполняется только для модулей с capability.

**REQ:** REQ-RWD-001 (ядро не зависит от rewards — только токен), REQ-RWD-003/010 (эффекты до событий в одной транзакции), REQ-RWD-005, REQ-RWD-011 (randomInt из хоста), REQ-RWD-014 (пул как данные ctx).

- [ ] **Step 1: Failing int-tests**

В `packages/core/src/app-runtime/app-runtime.int-spec.ts` добавить describe (бутстрап и TEST-APP хелперы — по существующим кейсам файла; фейковый модуль строится с `manifest.capabilities` и захватывает ctx):

```typescript
  // Заготовки к кейсам ниже: capabilityModule(overrides) — модуль с
  // capabilities: ['rewards'], handlePublish захватывает ctx и возвращает
  // заданные commits/effects; plainModule — без capabilities (форма возврата
  // по-прежнему допускает голый массив). Регистрация комнаты с TEST-манифестом —
  // существующий путь спека (configure + activate).

  it('backward compat: модуль, вернувший голый AppCommit[], коммитится как прежде', async () => {
    // publish клиентской команды plainModule → ack ok, событие в логе (существующий happy-path спека уже близок — здесь фиксируется именно старая форма возврата).
  });

  it('эффекты без capability → CAPABILITY_UNAVAILABLE, в лог ничего не попадает', async () => {
    // plainModule возвращает { commits: [echo], effects: [{ kind: 'award.points', ... }] }
    // → dispatch отклоняет ContractError code CAPABILITY_UNAVAILABLE;
    // logEvent.count({ roomId }) === baseline (ни echo, ни чего-либо ещё).
  });

  it('эффекты с capability, но без подключённого исполнителя → CAPABILITY_UNAVAILABLE (fail-closed)', async () => {
    // capabilityModule + effects, testing-module БЕЗ провайдера AWARD_EFFECT_HANDLER.
  });

  it('с подключённым исполнителем эффекты исполняются ДО коммитов одной транзакцией: отказ эффекта откатывает события', async () => {
    // Провайдер-спай { provide: AWARD_EFFECT_HANDLER, useValue: spy } где spy.executeEffects
    // бросает ContractError('PRIZE_FUND_EXHAUSTED', ...) → dispatch отклоняется,
    // в логе 0 новых событий; порядок «эффекты до коммитов» фиксируется записью
    // вызовов (spy помечает, что на момент вызова лога нет — читает logEvent.count через prisma внутри tx... упрощённо: spy вызывается, а событий в логе нет после отказа).
  });

  it('drawPool: capability-модуль получает активных PARTICIPANT (без организатора/зрителей/исключённых), plain-модуль — пустой пул', async () => {
    // Комната: организатор + 2 guest-PARTICIPANT + 1 SPECTATOR + 1 исключённый
    // (soft-delete membership). capabilityModule захватывает ctx.drawPool →
    // ровно 2 записи { identityId, kind: 'GUEST' }. plainModule → drawPool: [].
  });

  it('ctx.randomInt — node:crypto CSPRNG: границы и покрытие (REQ-RWD-011 sanity)', async () => {
    // Захваченный ctx: 3000 вызовов randomInt(3) → все в [0,3), встречаются все три значения.
  });
```

(Имена существующих хелперов спека — TEST_APP/регистрация модулей через `AppRuntimeModule.register([...])` в testing module — сверить с файлом и переиспользовать.)

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test:int -- app-runtime`
Expected: FAIL (CAPABILITY_UNAVAILABLE есть, но drawPool/исполнение не реализованы; новые describe падают).

- [ ] **Step 3: Implement — токен и интерфейс**

`packages/core/src/app-runtime/effects.ts`:

```typescript
import type { Prisma } from '@prisma/client';
import type { AppEffect } from '@mymozhem/sdk';

// DI-шов «ядро не зависит от rewards» (REQ-RWD-001, design 2026-09-10 §2):
// app-runtime знает только этот интерфейс; реализация — RewardsService,
// подключается в composition root. Boundary-правило запрещает остальным доменам
// ядра импорт core/rewards (Task 11).
export interface AwardEffectHandler {
  executeEffects(
    tx: Prisma.TransactionClient,
    roomId: string,
    sourceAppId: string,
    effects: readonly AppEffect[],
  ): Promise<void>;
}

export const AWARD_EFFECT_HANDLER = Symbol('AWARD_EFFECT_HANDLER');
```

- [ ] **Step 4: Implement — пул в membership**

`membership.service.ts`:

```typescript
  // Снапшот пула розыгрыша для хост-примитива drawPool (design 2026-09-10 §2):
  // активные PARTICIPANT-членства комнаты; организатор (роль ORGANIZER), зрители
  // (SPECTATOR), исключённые и soft-deleted не входят. Комната удалённая — пул пуст.
  async listActiveParticipantPool(roomId: string): Promise<DrawPoolEntry[]> {
    const rows = await this.prisma.membership.findMany({
      where: {
        roomId,
        role: 'PARTICIPANT',
        deletedAt: null,
        room: { deletedAt: null },
      },
      select: { identityId: true, identity: { select: { kind: true } } },
    });
    return rows.map((r) => ({ identityId: r.identityId, kind: r.identity.kind }));
  }
```

(импорт `type DrawPoolEntry` из `@mymozhem/sdk`.)

- [ ] **Step 5: Implement — диспетчер**

`app-runtime.service.ts`:
1. Конструктор += последним параметром:

```typescript
    @Optional() @Inject(AWARD_EFFECT_HANDLER)
    private readonly awardEffectHandler?: AwardEffectHandler,
```

(импорты `Optional`, `Inject` из '@nestjs/common'; `AWARD_EFFECT_HANDLER`, `AwardEffectHandler` из './effects'.)

2. В `dispatchLocked` после разрешения модуля (шаг 3) — capability:

```typescript
    const hasRewardsCapability = mod.manifest.capabilities?.includes('rewards') ?? false;
```

3. ctx: заменить заглушку `drawPool: []` (Task 3) на наполнение:

```typescript
      // Пул — только модулю с capability 'rewards' (design §2): publish'и квиза
      // не грузят membership. Запрос до вызова модуля, снапшот на момент команды.
      drawPool: hasRewardsCapability
        ? await this.membership.listActiveParticipantPool(params.roomId)
        : [],
```

4. Заменить fail-closed блок Task 3 (`if (effects.length > 0) throw CAPABILITY_UNAVAILABLE …`) на гейт и запоминание исполнителя:

```typescript
    let effectHandler: AwardEffectHandler | undefined;
    if (effects.length > 0) {
      if (!hasRewardsCapability) {
        // Эффект награждения без capability манифеста — отказ до исполнения (REQ-RWD-001).
        throw new ContractError(
          'CAPABILITY_UNAVAILABLE',
          `module ${mod.appId}@${mod.manifestVersion} emitted award effects without the 'rewards' capability`,
        );
      }
      effectHandler = this.awardEffectHandler;
      if (!effectHandler) {
        throw new ContractError(
          'CAPABILITY_UNAVAILABLE',
          'rewards effect handler is not wired in this deployment',
        );
      }
    }
```

5. В `outbox.run` перед циклом коммитов:

```typescript
    const committed = await this.outbox.run(async (tx) => {
      // Эффекты ДО событий (design §2): событие «победитель определён» не попадает
      // в лог, если награждение не состоялось; отказ эффекта откатывает всё.
      if (effectHandler) {
        await effectHandler.executeEffects(tx, params.roomId, mod.appId, effects);
      }
      const out = [];
      // ... цикл коммитов без изменений
```

(Валидация эффектов `appEffectSchema.safeParse` из Task 3 остаётся на месте.)

Barrel `index.ts` += `export * from './app-runtime/effects';`.

- [ ] **Step 6: Run — GREEN**

Run: `pnpm --filter @mymozhem/core test:int -- app-runtime && pnpm build && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core test:int`
Expected: PASS. Внимание к DI: AppRuntimeModule.register уже несёт `imports: [PrismaModule, MembershipModule, RealtimeModule]` — listActiveParticipantPool разрешается штатно; `AWARD_EFFECT_HANDLER` опционален (`@Optional()`), поэтому существующие testing-модули без провайдера не ломаются.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/app-runtime packages/core/src/membership packages/core/src/index.ts
git commit -m "feat(core): исполнение эффектов в app-runtime — capability-гейт, AWARD_EFFECT_HANDLER, drawPool/randomInt наполнение

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

