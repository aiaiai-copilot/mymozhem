### Task 1: ajv-formats на commit-гейте (enforcement `format: "uuid"`)

**Files:**
- Modify: `packages/core/package.json` (dep `ajv-formats`)
- Modify: `packages/core/src/app-registry/app-registry.service.ts:20` (подключение addFormats)
- Test: `packages/core/src/app-registry/app-registry.service.spec.ts` (существующий — расширить; если файла нет, создать рядом по общему паттерну `*.spec.ts`)

**Interfaces:**
- Consumes: существующий `AppRegistryService.eventValidatorFor(appId, manifestVersion, name, schema): ValidateFunction` (`app-registry.service.ts:62-79`).
- Produces: commit-гейт принуждает `format: "uuid"` (и прочие строковые форматы ajv-formats) для всех app-схем; невалидный uuid в payload отклоняется `EVENT_PAYLOAD_INVALID` до коммита. Опора для клиентских uuid-полей фазы 3 (`drawId`, `prizeId` — Tasks 3, 9).

**REQ:** REQ-CTR-008 (схема владельца принуждается на гейте), follow-up финального ревью ф.2 (AJV warning `unknown format "uuid" ignored`).

- [ ] **Step 1: Failing test — format uuid принуждается**

В `app-registry.service.spec.ts` добавить:

```typescript
// Фаза 3, Task 1 (решение владельца 2026-09-10): ajv-formats на commit-гейте.
// zod v4 эмитит format: "uuid" для z.uuid(); stock Ajv 8 без ajv-formats его
// игнорировал (warning "unknown format") — невалидный uuid проходил гейт.
describe('eventValidatorFor — string formats', () => {
  const service = new AppRegistryService([]);
  const validate = service.eventValidatorFor('testapp', 1, 'draw.run', {
    type: 'object',
    properties: { drawId: { type: 'string', format: 'uuid' } },
    required: ['drawId'],
    additionalProperties: false,
  });

  it('rejects a non-uuid drawId', () => {
    expect(validate({ drawId: 'not-a-uuid' })).toBe(false);
  });

  it('accepts an RFC 9562 uuid', () => {
    expect(validate({ drawId: '3f6b2b6e-9c5a-4f1e-8b2d-7a9c1e0f2a3b' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/core test -- app-registry`
Expected: FAIL — `rejects a non-uuid drawId` падает (validate вернул true; в stderr warning Ajv `unknown format "uuid" ignored`). Проверить, что фильтр `app-registry` матчит >0 тестов.

- [ ] **Step 3: Implement — подключить ajv-formats**

`packages/core/package.json`, в `dependencies` (рядом с `ajv`): `"ajv-formats": "^3.0.1"`. Затем `pnpm install` из корня (один lockfile, REQ-DEV-002).

`app-registry.service.ts`: импорт и перенос инициализации Ajv в конструктор:

```typescript
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
```

Поле `private readonly ajv = new Ajv2020(...)` (строка 20) заменить на объявление `private readonly ajv: Ajv2020;`, а в конструкторе первой строкой:

```typescript
    // ajv-formats (фаза 3, Task 1): zod v4 эмитит format: "uuid" для z.uuid();
    // без подключённых форматов Ajv 8 их игнорирует — uuid-поля клиентских команд
    // (drawId/prizeId лотереи) не принуждались бы на commit-гейте.
    this.ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(this.ajv);
```

(Существующий комментарий про Ajv2020/strict над полем перенести к объявлению.)

- [ ] **Step 4: Run — GREEN + регрессионный прогон**

Run: `pnpm --filter @mymozhem/core test && pnpm build && pnpm --filter @mymozhem/core test:int`
Expected: PASS. Внимание: enforcement ломает старые invalid-uuid литералы в int/e2e-спеках (известный follow-up-пакет «чистка invalid-uuid литералов» из HANDOFF — закрывается здесь). Если упавшие спеки найдены — заменить литералы на RFC 9562-валидные v4 uuid (прецедент комментария в `apps/server/test/quiz.e2e-spec.ts:26-28`: z.uuid() zod v4 отклоняет версию 0). Прогнать и `pnpm --filter @mymozhem/server test` (после `pnpm build`) — убедиться, что e2e зелёные.

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/app-registry
git commit -m "feat(core): ajv-formats на commit-гейте — enforcement format: uuid

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

