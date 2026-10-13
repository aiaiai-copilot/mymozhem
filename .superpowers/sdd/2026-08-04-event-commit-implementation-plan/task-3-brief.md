### Task 3: Realtime-ошибки + event-методы AppRegistryService

**Files:**
- Create: `packages/core/src/realtime/realtime.errors.ts`
- Modify: `packages/core/src/app-registry/app-registry.service.ts`
- Test: `packages/core/src/app-registry/app-registry.service.spec.ts`

**Interfaces:**
- Consumes: `AppManifest['events'][string]` (SDK), `isWithinCeiling` из `@mymozhem/sdk` (НЕ тестируется здесь — уже покрыт SDK-спекой).
- Produces:
  - `REALTIME_ERROR_CODES` + классы `RealtimeError`, `RoomNotActiveError`, `EventEmitRateLimitedError`, `EventPayloadTooLargeError`, `EventTypeUnknownError`, `EventPayloadInvalidError`, `EventVisibilityExceededError`, `ActorNotMemberError` — потребляет Task 5.
  - `AppRegistryService.getEventDefinition(appId: string, manifestVersion: number, name: string): AppManifest['events'][string] | undefined`
  - `AppRegistryService.eventValidatorFor(appId: string, manifestVersion: number, name: string, schema: JsonSchemaObject): ValidateFunction`
  - `AppRegistryService.describeEventErrors(validate: ValidateFunction): string`

- [ ] **Step 1: Write the failing tests**

В `packages/core/src/app-registry/app-registry.service.spec.ts` добавить describe (импорты `ValidateFunction` не нужен в спеке — работаем через публичные методы):

```ts
describe('event-commit read-path (REQ-CTR-008/009)', () => {
  it('getEventDefinition returns schema+visibility for a known type, undefined for unknown', () => {
    const svc = new AppRegistryService([validManifests[0]]);
    const def = svc.getEventDefinition('quiz', 1, 'answer.submitted');
    expect(def?.visibility).toBe('module-private');
    expect(def?.schema).toMatchObject({ type: 'object' });
    expect(svc.getEventDefinition('quiz', 1, 'answer.v2')).toBeUndefined();
    expect(svc.getEventDefinition('nope', 1, 'answer.submitted')).toBeUndefined();
  });

  it('eventValidatorFor compiles, caches and validates the registered schema', () => {
    const svc = new AppRegistryService([validManifests[0]]);
    const def = svc.getEventDefinition('quiz', 1, 'answer.submitted');
    if (!def) throw new Error('fixture must define answer.submitted');
    const v1 = svc.eventValidatorFor('quiz', 1, 'answer.submitted', def.schema);
    const v2 = svc.eventValidatorFor('quiz', 1, 'answer.submitted', def.schema);
    expect(v1).toBe(v2); // кэш REQ-CORE-007
    expect(v1({ roundId: 'r1', choice: 2 })).toBe(true);
    expect(v1({ roundId: 'r1', choice: 'x' })).toBe(false);
  });

  it('describeEventErrors renders ajv errors after a failed validation', () => {
    const svc = new AppRegistryService([validManifests[0]]);
    const def = svc.getEventDefinition('quiz', 1, 'answer.submitted');
    if (!def) throw new Error('fixture must define answer.submitted');
    const v = svc.eventValidatorFor('quiz', 1, 'answer.submitted', def.schema);
    expect(v({})).toBe(false);
    expect(svc.describeEventErrors(v)).toMatch(/roundId|required/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mymozhem/core test -t "event-commit read-path"`
Expected: FAIL — `getEventDefinition` не существует. Фильтр матчит 3 теста.

- [ ] **Step 3a: Create realtime errors**

Создать `packages/core/src/realtime/realtime.errors.ts`:

```ts
// Core-internal typed errors of the event-commit chain (design §6). Не часть
// SDK-контракта: wire-маппинг придёт с realtime-транспортом (EVENT_EMIT_RATE_LIMITED
// → единый RATE_LIMITED по конвенции transport-среза).
export const REALTIME_ERROR_CODES = {
  ROOM_NOT_ACTIVE: 'ROOM_NOT_ACTIVE',
  EVENT_EMIT_RATE_LIMITED: 'EVENT_EMIT_RATE_LIMITED',
  EVENT_PAYLOAD_TOO_LARGE: 'EVENT_PAYLOAD_TOO_LARGE',
  EVENT_TYPE_UNKNOWN: 'EVENT_TYPE_UNKNOWN',
  // Строковый паритет с кодом ContractError SDK (commitCoreEvent): будущий транспорт
  // отобразит code→code 1:1.
  EVENT_PAYLOAD_INVALID: 'EVENT_PAYLOAD_INVALID',
  EVENT_VISIBILITY_EXCEEDED: 'EVENT_VISIBILITY_EXCEEDED',
  ACTOR_NOT_MEMBER: 'ACTOR_NOT_MEMBER',
} as const;

export type RealtimeErrorCode = (typeof REALTIME_ERROR_CODES)[keyof typeof REALTIME_ERROR_CODES];

export class RealtimeError extends Error {
  constructor(
    readonly code: RealtimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

// Эмит не в ACTIVE: DRAFT, терминальная (запечатывание REQ-RT-016), удалённая или
// отсутствующая комната — причины свёрнуты в один код (точность — в message).
export class RoomNotActiveError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.ROOM_NOT_ACTIVE, message);
  }
}

// REQ-RT-014: превышен per-actor хард rate-limit эмиссии — отказ, не алерт.
export class EventEmitRateLimitedError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.EVENT_EMIT_RATE_LIMITED, message);
  }
}

// REQ-RT-012: payload больше max_event_payload.
export class EventPayloadTooLargeError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.EVENT_PAYLOAD_TOO_LARGE, message);
  }
}

// REQ-CTR-008: тип события отсутствует в пиннутом манифесте.
export class EventTypeUnknownError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.EVENT_TYPE_UNKNOWN, message);
  }
}

// REQ-CTR-008: payload не соответствует зарегистрированной схеме владельца типа.
export class EventPayloadInvalidError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.EVENT_PAYLOAD_INVALID, message);
  }
}

// REQ-CTR-009: фактическая видимость слабее декларированного для типа потолка.
export class EventVisibilityExceededError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.EVENT_VISIBILITY_EXCEEDED, message);
  }
}

// Membership-гейт (design §0): actorId не член комнаты.
export class ActorNotMemberError extends RealtimeError {
  constructor(message: string) {
    super(REALTIME_ERROR_CODES.ACTOR_NOT_MEMBER, message);
  }
}
```

- [ ] **Step 3b: Add event methods to AppRegistryService**

В `packages/core/src/app-registry/app-registry.service.ts` добавить публичные методы (после `validateSettings`):

```ts
  // REQ-CTR-008/009 read-path для event-commit цепочки: схема + декларированный
  // потолок видимости типа из манифеста. undefined = неизвестный тип/манифест.
  getEventDefinition(
    appId: string,
    manifestVersion: number,
    name: string,
  ): AppManifest['events'][string] | undefined {
    return this.registry.getManifest(appId, manifestVersion)?.events[name];
  }

  // Валидаторы app-событий — в том же кэше, что appSettings (REQ-CORE-007), с
  // префиксом ключа, чтобы не пересекаться с ключом настроек `appId@version`.
  eventValidatorFor(
    appId: string,
    manifestVersion: number,
    name: string,
    schema: JsonSchemaObject,
  ): ValidateFunction {
    const key = `event:${appId}@${manifestVersion}:${name}`;
    const cached = this.validators.get(key);
    if (cached) {
      return cached;
    }
    const compiled = this.ajv.compile(schema);
    this.validators.set(key, compiled);
    return compiled;
  }

  describeEventErrors(validate: ValidateFunction): string {
    return this.ajv.errorsText(validate.errors);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mymozhem/core test -t "event-commit read-path"` → PASS (3 теста).
Run: `pnpm --filter @mymozhem/core test` → весь suite зелёный. `pnpm typecheck` → зелёный.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/realtime/realtime.errors.ts packages/core/src/app-registry/app-registry.service.ts packages/core/src/app-registry/app-registry.service.spec.ts
git commit -m "feat(core): realtime errors + event read-path в AppRegistryService (REQ-CTR-008/009)"
```

---

