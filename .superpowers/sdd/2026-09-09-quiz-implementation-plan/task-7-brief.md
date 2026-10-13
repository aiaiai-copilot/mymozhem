### Task 7: core — gateway на диспетчер

**Files:**
- Modify: `packages/core/src/realtime/realtime.gateway.ts:193-243` (handlePublish, удалить `effectiveVisibility`)
- Modify: `packages/core/src/realtime/realtime.module.ts` — провайдеры без изменений, gateway инжектит `AppRuntimeService` (разрешение через global AppRuntimeModule из Task 6; статический импорт не нужен)
- Modify: `packages/core/src/realtime/realtime.gateway.spec.ts` — моки под новый путь
- Modify: `apps/server/test/realtime.e2e-spec.ts` — регистрация passthrough-модуля для TEST_APP
- Modify: `apps/server/src/app.module.ts` — `AppRuntimeModule.register([])` (пусто до Task 12)

**Interfaces:**
- Consumes: `AppRuntimeService.dispatch` (Task 6).
- Produces: путь publish: gateway → dispatcher. Поле `PublishRequest.visibility` для app-типов более не читается (visibility задаёт модуль в AppCommit; ceiling принуждается commit'ом, REQ-CTR-009) — комментарий в коде.

**Почему passthrough в e2e:** с вводом диспетчера app-тип без рантайм-модуля — `MODULE_UNAVAILABLE` (fail-closed). Существующий realtime.e2e публикует `note.posted` напрямую; его TEST_APP получает модуль-заглушку «коммитить вход как есть» (actor: publisher, visibility из манифеста) — семантика фазы 1 сохранена явно.

- [ ] **Step 1: Failing gateway unit spec**

`realtime.gateway.spec.ts`: publish app-типа вызывает `appRuntime.dispatch` с `{ roomId из подписки, actorId из claims, appId, shortName, payload }`; core-тип — по-прежнему `EVENT_UNKNOWN_TYPE` без вызова dispatch; отказ диспетчера (`AppRejection`) → ack `{code}`.

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test -- realtime.gateway`
Expected: FAIL.

- [ ] **Step 3: Implement gateway rewiring**

В `handlePublish` после `resolveTypeOwner` и отказа core-неймспейса:

```typescript
      const owner = resolveTypeOwner(parsed.data.type);
      if (owner.kind === 'core') {
        ack({ code: 'EVENT_UNKNOWN_TYPE' });
        return;
      }
      // Командный хост (design 2026-09-09 §2): app-publish исполняется модулем до
      // коммита. request.visibility здесь не читается — набор и видимость коммитов
      // определяет модуль (AppCommit), потолок принуждается commit'ом (REQ-CTR-009).
      await this.appRuntime.dispatch({
        roomId: sub.roomId,
        actorId: claimsOf(socket).sub,
        appId: owner.appId,
        shortName: owner.shortName,
        payload: parsed.data.payload,
      });
      ack({ ok: true });
```

Удалить `effectiveVisibility` и ставшие неиспользуемыми импорты (`EventLogService`/`EventOutbox`/`AppRegistryService` из конструктора — только если более не нужны: `appRegistry` ещё нужен в subscribe для manifest snapshot; `eventLog`/`outbox` из gateway уходят). Конструктор: `- eventLog, - outbox, + appRuntime: AppRuntimeService`.

- [ ] **Step 4: e2e passthrough**

В `realtime.e2e-spec.ts` рядом с TEST_APP:

```typescript
// Passthrough-модуль фазы-1 семантики (design 2026-09-09 §7): коммитит клиентский
// вход как есть, visibility — декларированный потолок типа.
const TEST_APP_MODULE: AppRuntimeModule = {
  appId: TEST_APP.appId,
  manifestVersion: TEST_APP.manifestVersion,
  manifest: TEST_APP,
  initialState: () => ({}),
  reduce: (state) => state,
  handlePublish: (_ctx, shortName, payload) => [
    { shortName, payload, visibility: TEST_APP.events[shortName]!.visibility, actor: 'publisher' as const },
  ],
};
```

`createApp`: `.overrideProvider(APP_RUNTIME_MODULES).useValue([TEST_APP_MODULE])` (добавить к существующему override APP_MANIFESTS; импорт токена из `@mymozhem/core`).

- [ ] **Step 5: Run — GREEN**

Run: `pnpm build && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/server test`
Expected: PASS (все realtime e2e зелёные на новом пути).

- [ ] **Step 6: Commit**

```bash
git add packages/core apps/server
git commit -m "feat(core): gateway publish → app-runtime диспетчер; passthrough-модуль в realtime e2e

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

