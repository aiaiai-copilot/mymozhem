### Task 4: SDK — рантайм-контракт модуля

**Files:**
- Create: `packages/sdk/src/app-runtime/app-commit.ts`
- Create: `packages/sdk/src/app-runtime/app-log-event.ts`
- Create: `packages/sdk/src/app-runtime/app-host-context.ts`
- Create: `packages/sdk/src/app-runtime/app-rejection.ts`
- Create: `packages/sdk/src/app-runtime/app-runtime-module.ts`
- Create: `packages/sdk/src/app-runtime/app-commit.fixtures.ts`
- Test: `packages/sdk/src/app-runtime/app-commit.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Produces (их потребляют Task 6 и Task 9–11):

```typescript
// app-commit.ts — что модуль просит ядро зафиксировать. actor: 'publisher' —
// событие атрибутируется клиенту (membership-гейт и per-actor rate-limit применяются);
// 'server' — эмиссия модуля (actorId=null, гейты не применяются, как в commitAppEvent).
export const appCommitActorSchema = z.enum(['publisher', 'server']);
export const appCommitSchema = z.strictObject({
  shortName: shortEventNameSchema,
  payload: z.record(z.string(), z.unknown()),
  visibility: visibilitySchema,
  actor: appCommitActorSchema,
});
export type AppCommit = z.infer<typeof appCommitSchema>;

// app-log-event.ts — событие лога как его видит модуль при replay. recordedAt —
// ISO-строка, не Date: через границу ходят только JSON-сериализуемые значения
// (REQ-CTR-002); модуль делает Date.parse сам.
export interface AppLogEvent {
  readonly shortName: string;
  readonly payload: Record<string, unknown>;
  readonly actorId: string | null;
  readonly seq: number;
  readonly recordedAt: string;
}

// app-host-context.ts — now тоже ISO-строка (та же причина).
export interface AppHostContext<S> {
  readonly roomId: string;
  readonly actorId: string;
  readonly actorRole: MemberRole;
  readonly settings: unknown;
  readonly state: S;
  readonly now: string;
}

// app-rejection.ts — типизированный отказ модуля; код обязан быть в CONTRACT_ERROR_CODES.
export class AppRejection extends ContractError {
  constructor(code: ContractErrorCode, message: string) {
    super(code, message);
    this.name = 'AppRejection';
  }
}

// app-runtime-module.ts
export interface AppRuntimeModule<S = unknown> {
  readonly appId: string;
  readonly manifestVersion: number;
  readonly manifest: AppManifest;
  initialState(): S;
  reduce(state: S, event: AppLogEvent): S;
  handlePublish(
    ctx: AppHostContext<S>,
    shortName: string,
    payload: Record<string, unknown>,
  ): AppCommit[] | Promise<AppCommit[]>;
}
```

**REQ:** REQ-CTR-002/003/005.

- [ ] **Step 1: Failing contract test**

`app-commit.contract.spec.ts`: валидные фикстуры проходят `appCommitSchema`, невалидные (лишний ключ, невалидный shortName `Quiz.x`, неизвестная visibility, actor вне enum) отклоняются. Фикстуры — в `app-commit.fixtures.ts` (пары valid/invalid по образцу `visibility.fixtures.ts`).

- [ ] **Step 2: Run — RED**

Run: `pnpm --filter @mymozhem/sdk test -- app-commit`
Expected: FAIL (модуль не существует).

- [ ] **Step 3: Implement** — файлы из блока Interfaces выше + экспорты в `index.ts` (`export * from './app-runtime/...';` — все пять файлов + fixtures).

- [ ] **Step 4: Run — GREEN**

Run: `pnpm --filter @mymozhem/sdk test && pnpm --filter @mymozhem/sdk typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): рантайм-контракт app-модуля — AppRuntimeModule/AppCommit/AppHostContext/AppRejection (REQ-CTR-002/003)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

