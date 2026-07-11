# Phase 0 — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the MyMozhem monorepo as a working AIDD environment — a machine-enforced module boundary, a zod contract package with self-testing fixtures, a bootable NestJS/Fastify artifact, and full CI — with zero domain logic.

**Architecture:** pnpm workspace with `packages/*` (contract SDK + core) and `apps/*` (composition root). The module boundary is enforced by dependency-cruiser in CI, and a "gate-checks-the-gate" script proves the enforcer itself is alive by injecting known violations and asserting it fails. The server is a NestJS app on the Fastify adapter exposing liveness/readiness; readiness proves real DB connectivity through a minimal Prisma client.

**Tech Stack:** pnpm 11 · turbo 2 · TypeScript 5.7 · dependency-cruiser 16 · ESLint 9 (flat) + typescript-eslint 8 · zod 4 · NestJS 11 (@nestjs/platform-fastify) · Prisma 7 (prisma-client-js generator) · PostgreSQL 17 · Jest 29 (ts-jest) · Docker · GitHub Actions.

## Global Constraints

Copied verbatim from the design (`docs/sessions/2026-07-11-phase-0-walking-skeleton-design.md`) and the normative package v1.2. Every task implicitly includes these.

- **One lockfile** at repo root; pnpm is the only package manager (REQ-DEV-002).
- **Node >= 24** (image pins `node:24-slim`; local dev may be newer).
- **Package manager pinned:** `pnpm@11.1.3` in root `packageManager`.
- **Boundary is machine-enforced from the first commit** — never by convention (ADR-002, REQ-CTR-001, REQ-DEV-001).
- **npm scope** `@mymozhem/*`: `@mymozhem/sdk`, `@mymozhem/core`, `@mymozhem/server`.
- **No forward scaffolding**: no `app-quiz`/`rewards` packages, no Prisma models, no auth, no socket.io, no OpenAPI generation. A future extension point is fixed in words in an ADR, never as empty code (roadmap §5, ADR-001, REQ-OPS-005).
- **Session/AIDD artifacts live in `docs/`, never repo root** (REQ-DEV-003).
- **ADR-001…011 and ADR-005a are binding**; deviation only via a new ADR before merge (REQ-DEV-004).
- **Business logic only in services**; controllers/gateways carry transport wiring only (REQ-CORE-006) — applies from the first file.

---

## File Structure

```
mymozhem/
├── package.json                      # root: private, scripts, dev tooling, packageManager
├── pnpm-workspace.yaml               # workspace globs
├── .npmrc                            # engine-strict
├── turbo.json                        # build/lint/typecheck/test tasks
├── tsconfig.base.json                # shared compiler options
├── eslint.config.js                  # flat config; bans module-level mutable state (REQ-CORE-004)
├── .dependency-cruiser.cjs           # boundary rules (REQ-CTR-001, REQ-RT-006)
├── prisma.config.ts                  # Prisma 7 config: schema path + datasource url from env
├── .gitignore
├── .dockerignore
├── Dockerfile                        # multi-stage; runtime = migrate deploy + node
├── docker-compose.yml                # postgres + server
├── scripts/
│   └── verify-guardrails.mjs         # gate-checks-the-gate (REQ-DEV-001)
├── docker/
│   └── entrypoint.sh                 # migrate deploy, then start server (REQ-OPS-002)
├── .github/workflows/ci.yml          # install --frozen-lockfile → lint/typecheck/test/build → guardrails
├── docs/
│   ├── legal/questions-for-lawyer.md # §6.1 gate prep (non-blocking)
│   └── spec/amendment-v1.3-phase-remapping.md  # draft for owner (§1.4 of design)
├── packages/
│   ├── sdk/                          # @mymozhem/sdk — zod contract + fixtures + contract tests
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── jest.config.js
│   │   └── src/
│   │       ├── index.ts
│   │       ├── events/log-event.schema.ts
│   │       ├── events/log-event.fixtures.ts
│   │       └── events/log-event.contract.spec.ts
│   └── core/                         # @mymozhem/core — Nest modules (health, config, prisma)
│       ├── package.json
│       ├── tsconfig.json
│       ├── jest.config.js
│       ├── prisma/schema.prisma
│       └── src/
│           ├── index.ts
│           ├── config/config.schema.ts
│           ├── config/config.schema.spec.ts
│           ├── config/config.module.ts
│           ├── config/config.service.ts
│           ├── prisma/prisma.service.ts
│           ├── prisma/prisma.module.ts
│           ├── health/health.controller.ts
│           └── health/health.module.ts
└── apps/
    └── server/                       # @mymozhem/server — composition root
        ├── package.json
        ├── tsconfig.json
        ├── jest.config.js
        ├── src/main.ts
        ├── src/app.module.ts
        └── test/health.e2e-spec.ts
```

---

## Task 1: Monorepo skeleton and toolchain

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `turbo.json`, `tsconfig.base.json`, `.gitignore`

**Interfaces:**
- Produces: root scripts `build`, `lint`, `typecheck`, `test`, `guardrails` (delegating to turbo / node); a single `pnpm-lock.yaml`; `tsconfig.base.json` extended by every package.

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

- [ ] **Step 2: Create `.npmrc`**

```ini
engine-strict=true
```

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "mymozhem",
  "private": true,
  "packageManager": "pnpm@11.1.3",
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "guardrails": "node scripts/verify-guardrails.mjs"
  },
  "devDependencies": {
    "@eslint/js": "^9.17.0",
    "dependency-cruiser": "^16.5.0",
    "dotenv": "^16.4.0",
    "eslint": "^9.17.0",
    "prisma": "^7.6.0",
    "turbo": "^2.3.0",
    "typescript": "^5.7.0",
    "typescript-eslint": "^8.19.0"
  }
}
```

- [ ] **Step 4: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] },
    "lint": {}
  }
}
```

- [ ] **Step 5: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2023"],
    "declaration": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 6: Create `.gitignore`**

```gitignore
node_modules/
dist/
.turbo/
*.tsbuildinfo
.env
coverage/
```

- [ ] **Step 7: Install and verify a single lockfile is produced**

Run: `pnpm install`
Expected: completes; exactly one `pnpm-lock.yaml` at repo root (`git status` shows it; no lockfiles under `packages/` or `apps/`).

Run: `pnpm exec turbo run build --dry=json | head -c 60`
Expected: prints JSON (turbo resolves; no tasks yet is fine).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json .gitignore pnpm-lock.yaml
git commit -m "chore: scaffold pnpm+turbo monorepo toolchain (REQ-DEV-002)"
```

---

## Task 2: SDK package and first contract schema

**Files:**
- Create: `packages/sdk/package.json`, `packages/sdk/tsconfig.json`, `packages/sdk/jest.config.js`
- Create: `packages/sdk/src/events/log-event.schema.ts`, `packages/sdk/src/events/log-event.fixtures.ts`
- Test: `packages/sdk/src/events/log-event.contract.spec.ts`
- Create: `packages/sdk/src/index.ts`

**Interfaces:**
- Produces: `logEventSchema` (zod), `visibilitySchema`, `VISIBILITY_LEVELS`, types `LogEvent`, `Visibility`; fixture arrays `validLogEvents: LogEvent[]` and `invalidLogEventCases: { name: string; value: unknown }[]`. All re-exported from `@mymozhem/sdk`.

- [ ] **Step 1: Create `packages/sdk/package.json`**

```json
{
  "name": "@mymozhem/sdk",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "jest"
  },
  "dependencies": { "zod": "^4.0.0" },
  "devDependencies": {
    "@types/jest": "^29.5.14",
    "@types/node": "^24.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `packages/sdk/tsconfig.json` and `packages/sdk/jest.config.js`**

`packages/sdk/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/sdk/jest.config.js`:
```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
};
```

- [ ] **Step 3: Install workspace deps**

Run: `pnpm install`
Expected: completes; `@mymozhem/sdk` linked in workspace.

- [ ] **Step 4: Write the failing contract test**

`packages/sdk/src/events/log-event.contract.spec.ts`:
```ts
import { logEventSchema } from './log-event.schema';
import { validLogEvents, invalidLogEventCases } from './log-event.fixtures';

describe('logEvent contract', () => {
  it.each(validLogEvents.map((e, i) => [i, e] as const))(
    'accepts valid fixture #%i',
    (_i, event) => {
      const result = logEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    },
  );

  it.each(invalidLogEventCases.map((c) => [c.name, c.value] as const))(
    'rejects invalid fixture: %s',
    (_name, value) => {
      const result = logEventSchema.safeParse(value);
      expect(result.success).toBe(false);
    },
  );

  it('rejects a visibility level weaker than the declared enum', () => {
    const bad = { ...validLogEvents[0], visibility: 'secret' };
    expect(logEventSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: FAIL — cannot find module `./log-event.schema` / `./log-event.fixtures`.

- [ ] **Step 6: Implement the schema**

`packages/sdk/src/events/log-event.schema.ts`:
```ts
import { z } from 'zod';

// Visibility levels of room state, log events and appSettings (REQ-CORE-005).
export const VISIBILITY_LEVELS = ['public', 'organizer', 'module-private'] as const;
export const visibilitySchema = z.enum(VISIBILITY_LEVELS);
export type Visibility = z.infer<typeof visibilitySchema>;

// Append-only log event envelope (form of REQ-RT-001). seq is server-assigned;
// actorId is null only for system/lifecycle events.
export const logEventSchema = z.object({
  roomId: z.uuid(),
  seq: z.number().int().nonnegative(),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  actorId: z.uuid().nullable(),
  visibility: visibilitySchema,
  schemaVersion: z.number().int().positive(),
});
export type LogEvent = z.infer<typeof logEventSchema>;
```

- [ ] **Step 7: Implement the fixtures**

`packages/sdk/src/events/log-event.fixtures.ts`:
```ts
import type { LogEvent } from './log-event.schema';

export const validLogEvents: LogEvent[] = [
  {
    roomId: '11111111-1111-4111-8111-111111111111',
    seq: 0,
    type: 'room.created',
    payload: { policy: 'guests' },
    actorId: null,
    visibility: 'public',
    schemaVersion: 1,
  },
  {
    roomId: '11111111-1111-4111-8111-111111111111',
    seq: 1,
    type: 'quiz.answer_scored',
    payload: { correct: true },
    actorId: '22222222-2222-4222-8222-222222222222',
    visibility: 'module-private',
    schemaVersion: 1,
  },
];

export const invalidLogEventCases: { name: string; value: unknown }[] = [
  {
    name: 'unknown visibility level',
    value: { ...validLogEvents[0], visibility: 'secret' },
  },
  {
    name: 'missing seq',
    value: (() => {
      const { seq, ...rest } = validLogEvents[0];
      return rest;
    })(),
  },
  {
    name: 'negative seq',
    value: { ...validLogEvents[0], seq: -1 },
  },
  {
    name: 'non-uuid roomId',
    value: { ...validLogEvents[0], roomId: 'not-a-uuid' },
  },
];
```

- [ ] **Step 8: Create `packages/sdk/src/index.ts`**

```ts
export * from './events/log-event.schema';
export * from './events/log-event.fixtures';
```

- [ ] **Step 9: Run tests and build to verify they pass**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: PASS — all valid fixtures accepted, all invalid rejected.

Run: `pnpm --filter @mymozhem/sdk build`
Expected: emits `packages/sdk/dist/index.js` and `.d.ts`.

- [ ] **Step 10: Verify the "broken schema fails CI" exit criterion by hand, then revert**

Temporarily change `visibilitySchema` to `z.string()` in `log-event.schema.ts`, run `pnpm --filter @mymozhem/sdk test`.
Expected: the "rejects a visibility level weaker than the declared enum" test FAILS (a broken contract turns CI red).
Then revert the change and re-run — PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/sdk pnpm-lock.yaml
git commit -m "feat(sdk): log-event contract schema with self-testing fixtures (REQ-CTR-003, REQ-CTR-005)"
```

---

## Task 3: Boundary enforcement and the gate-checks-the-gate script

**Files:**
- Create: `.dependency-cruiser.cjs`, `eslint.config.js`, `scripts/verify-guardrails.mjs`

**Interfaces:**
- Consumes: `packages/sdk` and (forward-declared) `packages/core`, `packages/app-*` path patterns.
- Produces: `pnpm run guardrails` — exits non-zero if either enforcer fails to catch an injected violation; exits 0 only when both enforcers demonstrably fire.

- [ ] **Step 1: Create `.dependency-cruiser.cjs`**

```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'sdk-is-leaf',
      comment: 'SDK не импортирует внутренние пакеты — это лист контракта (REQ-CTR-002).',
      severity: 'error',
      from: { path: '^packages/sdk/src' },
      to: { path: '^packages/', pathNot: '^packages/sdk/' },
    },
    {
      name: 'app-only-through-sdk',
      comment: 'App-модуль общается с ядром только через SDK, не напрямую (REQ-CTR-001).',
      severity: 'error',
      from: { path: '^packages/app-' },
      to: { path: '^packages/core/' },
    },
    {
      name: 'socketio-only-in-realtime',
      comment: 'socket.io импортируется только из Realtime-модуля ядра (REQ-RT-006).',
      severity: 'error',
      from: { pathNot: '^packages/core/src/realtime' },
      to: { path: 'node_modules/socket[.]io' },
    },
    {
      name: 'no-circular',
      comment: 'Циклические зависимости запрещены.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Импорт несуществующего модуля — ошибка (ловит опечатки; делает gate-probe независимым от порядка задач).',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
  },
};
```

Note on the `not-to-unresolvable` rule: it makes the gate-checks-the-gate boundary probe fire regardless of task order — before `packages/core` exists the probe import is unresolvable (fires here), and once it exists the import resolves under `^packages/core/` and fires on `sdk-is-leaf`. Either way `depcruise` exits non-zero, which is what the script asserts.

- [ ] **Step 2: Create `eslint.config.js` (flat config, bans module-level mutable state)**

```js
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

const moduleLevelMutableRule = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "Program > VariableDeclaration[kind='let']",
      message: 'Мутабельное module-level состояние запрещено (REQ-CORE-004).',
    },
    {
      selector: "Program > VariableDeclaration[kind='var']",
      message: 'Мутабельное module-level состояние запрещено (REQ-CORE-004).',
    },
    {
      selector: "Program > ExportNamedDeclaration > VariableDeclaration[kind='let']",
      message: 'Мутабельный module-level экспорт запрещён (REQ-CORE-004).',
    },
    {
      selector: "Program > ExportNamedDeclaration > VariableDeclaration[kind='var']",
      message: 'Мутабельный module-level экспорт запрещён (REQ-CORE-004).',
    },
  ],
};

module.exports = tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: moduleLevelMutableRule,
  },
);
```

- [ ] **Step 3: Verify both enforcers run clean on real code**

Run: `pnpm exec depcruise packages --config .dependency-cruiser.cjs`
Expected: `no dependency violations found`.

Run: `pnpm exec eslint packages/sdk/src`
Expected: no errors.

- [ ] **Step 4: Write the gate-checks-the-gate script**

`scripts/verify-guardrails.mjs`:
```js
// Proves the guardrails themselves are alive: injects a KNOWN violation and
// asserts each enforcer fails on it. A silently-green fence is the v1 failure
// mode this closes (ADR-002, REQ-DEV-001).
import { execSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';

function expectFailure(label, cmd) {
  try {
    execSync(cmd, { stdio: 'pipe' });
  } catch {
    console.log(`OK   — guardrail fired on: ${label}`);
    return;
  }
  console.error(`FAIL — guardrail did NOT fire on: ${label}`);
  process.exitCode = 1;
}

// 1) Boundary probe: a file in sdk importing core (forbidden: sdk is a leaf).
const boundaryProbe = 'packages/sdk/src/__guardrail_probe__.ts';
writeFileSync(
  boundaryProbe,
  "import '../../core/src/health/health.module';\nexport const probe = 1;\n",
);

// 2) Mutable-state probe: a top-level `let` export (forbidden: REQ-CORE-004).
mkdirSync('scripts/__probe__', { recursive: true });
const mutableProbe = 'scripts/__probe__/mutable.ts';
writeFileSync(mutableProbe, 'export let leaked = 1;\nleaked = 2;\n');

try {
  expectFailure(
    'sdk → core import (dependency-cruiser)',
    `pnpm exec depcruise ${boundaryProbe} --config .dependency-cruiser.cjs`,
  );
  expectFailure(
    'module-level mutable export (eslint)',
    `pnpm exec eslint ${mutableProbe} --no-ignore`,
  );
} finally {
  rmSync(boundaryProbe, { force: true });
  rmSync('scripts/__probe__', { recursive: true, force: true });
}

if (process.exitCode) {
  console.error('\nGuardrails are NOT enforcing. Fix before merge.');
} else {
  console.log('\nAll guardrails verified alive.');
}
```

- [ ] **Step 5: Run the script to verify it passes (both guardrails fire)**

Run: `pnpm run guardrails`
Expected:
```
OK   — guardrail fired on: sdk → core import (dependency-cruiser)
OK   — guardrail fired on: module-level mutable export (eslint)

All guardrails verified alive.
```
(Exit code 0. The probe files are auto-removed.)

- [ ] **Step 6: Verify the script catches a dead guardrail, then restore**

Temporarily comment out the `sdk-is-leaf` rule in `.dependency-cruiser.cjs`, run `pnpm run guardrails`.
Expected: `FAIL — guardrail did NOT fire on: sdk → core import` and non-zero exit.
Restore the rule and re-run — back to all-OK.

- [ ] **Step 7: Commit**

```bash
git add .dependency-cruiser.cjs eslint.config.js scripts/verify-guardrails.mjs pnpm-lock.yaml
git commit -m "feat: machine-enforced boundary + gate-checks-the-gate (ADR-002, REQ-CTR-001, REQ-DEV-001)"
```

---

## Task 4: Core config validation (zod)

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/jest.config.js`
- Create: `packages/core/src/config/config.schema.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/config/config.schema.spec.ts`

**Interfaces:**
- Produces: `configSchema` (zod), type `AppConfig = { NODE_ENV; PORT; DATABASE_URL }`, `loadConfig(env: NodeJS.ProcessEnv): AppConfig` (throws on invalid). Exported from `@mymozhem/core`.

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@mymozhem/core",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "jest",
    "prisma:generate": "prisma generate"
  },
  "dependencies": {
    "@mymozhem/sdk": "workspace:*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@prisma/client": "^7.6.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@nestjs/testing": "^11.0.0",
    "@types/jest": "^29.5.14",
    "@types/node": "^24.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json` and `packages/core/jest.config.js`**

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/core/jest.config.js`:
```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
};
```

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: completes; `@mymozhem/core` linked, depends on `@mymozhem/sdk` via workspace.

- [ ] **Step 4: Write the failing config test**

`packages/core/src/config/config.schema.spec.ts`:
```ts
import { loadConfig } from './config.schema';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('loadConfig', () => {
  it('applies defaults when only DATABASE_URL is provided', () => {
    const cfg = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(cfg.PORT).toBe(3000);
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.DATABASE_URL).toBe(base.DATABASE_URL);
  });

  it('coerces PORT from string', () => {
    const cfg = loadConfig({ ...base, PORT: '8080' } as NodeJS.ProcessEnv);
    expect(cfg.PORT).toBe(8080);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('throws when PORT is out of range', () => {
    expect(() => loadConfig({ ...base, PORT: '70000' } as NodeJS.ProcessEnv)).toThrow(/PORT/);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @mymozhem/core test`
Expected: FAIL — cannot find module `./config.schema`.

- [ ] **Step 6: Implement the config schema**

`packages/core/src/config/config.schema.ts`:
```ts
import { z } from 'zod';

// Startup config validation mechanism (REQ-OPS-003). Phase 0 keeps the surface
// minimal; §4 parameters arrive with their own phases.
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${detail}`);
  }
  return parsed.data;
}
```

- [ ] **Step 7: Create `packages/core/src/index.ts` (config exports only for now)**

```ts
export * from './config/config.schema';
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @mymozhem/core test`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): zod startup config validation (REQ-OPS-003)"
```

---

## Task 5: Prisma wiring and readiness DB check

**Files:**
- Create: `packages/core/prisma/schema.prisma`, `prisma.config.ts` (repo root)
- Create: `packages/core/src/prisma/prisma.service.ts`, `packages/core/src/prisma/prisma.module.ts`
- Modify: `packages/core/src/index.ts` (add prisma exports)
- Test: `packages/core/src/prisma/prisma.service.spec.ts`

**Interfaces:**
- Consumes: `@prisma/client` `PrismaClient`.
- Produces: `PrismaService extends PrismaClient` with `isHealthy(): Promise<boolean>`; `PrismaModule` (provides+exports `PrismaService`). Exported from `@mymozhem/core`.

> **Design note (deviation from design §3 task 5, recorded here for review):** the design said "datasource с multiSchema". Prisma 7 makes `multiSchema` GA but a `schemas=[...]` datasource is only valid once at least one model declares `@@schema`. Phase 0 has no models, so declaring `schemas` now would fail `prisma validate`. We therefore ship a minimal single-datasource schema in phase 0 and introduce `schemas=["core"]` together with the first `core` model in phase 1 — the ADR-006 mandate is met structurally when a model exists, not by an empty declaration. Phase 0 still validates the full toolchain: client generation, the `migrate deploy` deploy path, and a live `SELECT 1`.

- [ ] **Step 1: Create `packages/core/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}
```

- [ ] **Step 2: Create `prisma.config.ts` at repo root**

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'packages/core/prisma/schema.prisma',
  migrations: { path: 'packages/core/prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

- [ ] **Step 3: Generate the client and validate the schema**

Run: `pnpm exec prisma validate`
Expected: `The schema at packages/core/prisma/schema.prisma is valid 🚀`.

Run: `pnpm exec prisma generate`
Expected: `Generated Prisma Client` into `node_modules/@prisma/client`.

- [ ] **Step 4: Write the failing PrismaService test**

`packages/core/src/prisma/prisma.service.spec.ts`:
```ts
import { PrismaService } from './prisma.service';

describe('PrismaService.isHealthy', () => {
  it('returns true when the query succeeds', async () => {
    const svc = new PrismaService();
    jest.spyOn(svc, '$queryRaw' as never).mockResolvedValue([{ '?column?': 1 }] as never);
    await expect(svc.isHealthy()).resolves.toBe(true);
  });

  it('returns false when the query throws', async () => {
    const svc = new PrismaService();
    jest.spyOn(svc, '$queryRaw' as never).mockRejectedValue(new Error('no db') as never);
    await expect(svc.isHealthy()).resolves.toBe(false);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @mymozhem/core test -- prisma.service`
Expected: FAIL — cannot find module `./prisma.service`.

- [ ] **Step 6: Implement PrismaService and PrismaModule**

`packages/core/src/prisma/prisma.service.ts`:
```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  // Actual DB reachability for readiness (REQ-OPS-001).
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
```

`packages/core/src/prisma/prisma.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 7: Add prisma exports to `packages/core/src/index.ts`**

```ts
export * from './config/config.schema';
export * from './prisma/prisma.service';
export * from './prisma/prisma.module';
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @mymozhem/core test`
Expected: PASS (config + prisma service tests).

- [ ] **Step 9: Commit**

```bash
git add packages/core prisma.config.ts pnpm-lock.yaml
git commit -m "feat(core): prisma client wiring + readiness health check (REQ-OPS-001, REQ-OPS-002)"
```

---

## Task 6: Health module, server composition root, and e2e boot

**Files:**
- Create: `packages/core/src/health/health.controller.ts`, `packages/core/src/health/health.module.ts`
- Modify: `packages/core/src/index.ts` (export HealthModule)
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/jest.config.js`
- Create: `apps/server/src/app.module.ts`, `apps/server/src/main.ts`
- Test: `apps/server/test/health.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `PrismaModule`, `loadConfig` from `@mymozhem/core`.
- Produces: `HealthController` (`GET /health/live`, `GET /health/ready`), `HealthModule`; `AppModule`; a bootable `main.ts` listening on `0.0.0.0:PORT`.

- [ ] **Step 1: Implement the health controller and module**

`packages/core/src/health/health.controller.ts`:
```ts
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok'; db: true }> {
    const dbOk = await this.prisma.isHealthy();
    if (!dbOk) {
      throw new ServiceUnavailableException({ status: 'unavailable', db: false });
    }
    return { status: 'ok', db: true };
  }
}
```

`packages/core/src/health/health.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { HealthController } from './health.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 2: Export HealthModule from core**

Modify `packages/core/src/index.ts` — append:
```ts
export * from './health/health.controller';
export * from './health/health.module';
```

- [ ] **Step 3: Create the server package files**

`apps/server/package.json`:
```json
{
  "name": "@mymozhem/server",
  "version": "0.0.0",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "jest",
    "start": "node dist/main.js"
  },
  "dependencies": {
    "@mymozhem/core": "workspace:*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-fastify": "^11.0.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^11.0.0",
    "@types/jest": "^29.5.14",
    "@types/node": "^24.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.7.0"
  }
}
```

`apps/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`apps/server/jest.config.js`:
```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
};
```

- [ ] **Step 4: Install**

Run: `pnpm install`
Expected: completes; `@mymozhem/server` links `@mymozhem/core`.

- [ ] **Step 5: Write the failing e2e boot test**

`apps/server/test/health.e2e-spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '@mymozhem/core';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: NestFastifyApplication;
  const prismaStub = { isHealthy: jest.fn(), onModuleInit: jest.fn(), onModuleDestroy: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live → 200 ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready → 200 when DB healthy', async () => {
    prismaStub.isHealthy.mockResolvedValueOnce(true);
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: true });
  });

  it('GET /health/ready → 503 when DB down', async () => {
    prismaStub.isHealthy.mockResolvedValueOnce(false);
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @mymozhem/server test`
Expected: FAIL — cannot find module `../src/app.module`.

- [ ] **Step 7: Implement AppModule and main.ts**

`apps/server/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { HealthModule, PrismaModule } from '@mymozhem/core';

@Module({
  imports: [PrismaModule, HealthModule],
})
export class AppModule {}
```

`apps/server/src/main.ts`:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { loadConfig } from '@mymozhem/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  await app.listen(config.PORT, '0.0.0.0');
}

void bootstrap();
```

- [ ] **Step 8: Build core (dependency), then run the e2e test**

Run: `pnpm --filter @mymozhem/core build`
Expected: emits `packages/core/dist`.

Run: `pnpm --filter @mymozhem/server test`
Expected: PASS (live 200, ready 200, ready 503).

- [ ] **Step 9: Commit**

```bash
git add packages/core apps/server pnpm-lock.yaml
git commit -m "feat: health endpoints + NestJS/Fastify composition root (REQ-OPS-001, REQ-CORE-006)"
```

---

## Task 7: Docker artifact and compose

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker/entrypoint.sh`, `docker-compose.yml`

**Interfaces:**
- Consumes: the built workspace and generated Prisma client.
- Produces: a single image whose entrypoint runs `prisma migrate deploy` then starts the server; `docker compose up` brings up postgres + server.

- [ ] **Step 1: Create `.dockerignore`**

```gitignore
node_modules
**/node_modules
**/dist
.turbo
.git
.env
coverage
```

- [ ] **Step 2: Create `docker/entrypoint.sh`**

```sh
#!/bin/sh
set -e
# Deterministic migration on deploy (REQ-OPS-002). No-op until phase 1 adds models.
pnpm exec prisma migrate deploy
exec node apps/server/dist/main.js
```

- [ ] **Step 3: Create `Dockerfile` (multi-stage, node:24-slim)**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json prisma.config.ts ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm exec prisma generate
RUN pnpm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
COPY docker/entrypoint.sh /app/docker/entrypoint.sh
RUN chmod +x /app/docker/entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/app/docker/entrypoint.sh"]
```

- [ ] **Step 4: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: mymozhem
      POSTGRES_PASSWORD: mymozhem
      POSTGRES_DB: mymozhem
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mymozhem"]
      interval: 2s
      timeout: 3s
      retries: 20

  server:
    build: .
    environment:
      DATABASE_URL: postgresql://mymozhem:mymozhem@postgres:5432/mymozhem?schema=public
      PORT: 3000
      NODE_ENV: production
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
```

- [ ] **Step 5: Build and bring the stack up**

Run: `docker compose up --build -d`
Expected: `postgres` becomes healthy, then `server` starts and logs the Nest listen line.

- [ ] **Step 6: Verify the artifact boots and readiness is green (the exit criterion)**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health/live`
Expected: `200`.

Run: `curl -s http://localhost:3000/health/ready`
Expected: `{"status":"ok","db":true}`.

Run: `docker compose down`
Expected: stack stops cleanly.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore docker/entrypoint.sh docker-compose.yml
git commit -m "feat: single Docker artifact boots on one command (REQ-CORE-001, REQ-OPS-002)"
```

---

## Task 8: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root scripts (`lint`, `typecheck`, `test`, `build`, `guardrails`) and `prisma generate`.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.1.3
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec prisma generate
      - run: pnpm run typecheck
      - run: pnpm run lint
      - run: pnpm run test
      - run: pnpm run build
      - run: pnpm run guardrails
```

- [ ] **Step 2: Verify every CI step passes locally (CI mirrors these)**

Run: `pnpm install --frozen-lockfile && pnpm exec prisma generate && pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build && pnpm run guardrails`
Expected: every command exits 0; `guardrails` prints "All guardrails verified alive."

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint/typecheck/test/build + guardrails on every PR (REQ-DEV-001)"
```

---

## Task 9: Parallel non-blocking deliverables — legal questions and phase-remapping amendment

**Files:**
- Create: `docs/legal/questions-for-lawyer.md`
- Create: `docs/spec/amendment-v1.3-phase-remapping.md`

**Interfaces:** none (documentation). These are the §6.1 gate-prep and the §1.4 amendment draft from the design; they do not gate phase-0 code.

- [ ] **Step 1: Create `docs/legal/questions-for-lawyer.md`**

```markdown
# Вопросы юристу — гейт перед событием с посторонними/призами (§6.1)

Готовит агент; заключение даёт живой юрист. Не блокирует фазу 0.

1. **152-ФЗ и неудаляемый лог.** Мы храним append-only лог событий комнаты;
   право на удаление реализуем анонимизацией строки identity (обнуление PII,
   сохранение id и actorId в логе). Удовлетворяет ли анонимизация обязанности
   удаления ПДн, или требуется физическое удаление?
2. **Согласие гостя.** Гость входит по коду комнаты и имени, без регистрации.
   Какое согласие на обработку ПДн необходимо и как его фиксировать при
   гостевом входе?
3. **Стимулирующие лотереи.** Механика «лотерея с призом» на живом событии —
   подпадает ли под регулирование стимулирующих лотерей? Требования к правилам,
   уведомлению, срокам?
4. **Налог с выигрыша.** Кто налоговый агент при выдаче материального приза
   победителю; какие пороги и обязанности возникают у организатора/платформы?
5. **Локализация данных.** Требование хранения ПДн граждан РФ на территории РФ —
   как влияет на выбор хостинга единого артефакта и БД?
6. **Закрытый тест среди знакомых до заключения.** Допустимо ли провести
   закрытое событие в кругу знакомых (без посторонних, без денежных призов)
   до получения заключения юриста, и на каких условиях?
```

- [ ] **Step 2: Create `docs/spec/amendment-v1.3-phase-remapping.md`**

```markdown
# Амендмент v1.3 (черновик) — фазовая пере-разметка

**Статус:** черновик для решения владельца. Меняет разметку фаз, НЕ нормы.
Основание: организующий принцип «кратчайший путь к первому живому событию» +
фильтр задела для защитных норм (сессия 2026-07-11).

| Норма | Было (фаза 1) | Предлагается | Основание |
|---|---|---|---|
| REQ-RT-011 (метаданные seq) | MUST, ф.1 | SHOULD на MVP; MUST с механикой со скрытым таймингом | актор скрытого тайминга (T7) на живом квизе отсутствует; per-level нумерация нетривиальна |
| REQ-RT-014/015 (лимиты/бэкофф) | полностью, ф.1 | базовый per-actor rate-limit — ф.1; режимы/reconnect-бэкофф — ф.4 | флудер-вектор маловероятен на одной комнате знакомых |
| REQ-ID-019 (глобальный backoff) | ф.1 | per-IP (REQ-ID-006) — ф.1; глобальный слой — ф.4 | распределённый перебор — угроза этапа «много комнат» |
| REQ-ID-018 + право исключения MODERATOR | ф.1 (дубль с ф.4) | в MVP исключает только ORGANIZER; MODERATOR получает право вместе с контролями ID-018 в ф.4 | право без контролей нарушает букву REQ-ID-011 |
| Kind-флип flow (REQ-ID-004/017 как код) | ф.1 | после первого события; схема с `kind` и partial index — с ф.1 | на первом событии привязки аккаунта нет |

**Не меняется:** формулировки норм, их уровни MUST/SHOULD как таковые вне
указанной пере-привязки к фазам, ADR-001…011.
```

- [ ] **Step 3: Commit**

```bash
git add docs/legal/questions-for-lawyer.md docs/spec/amendment-v1.3-phase-remapping.md
git commit -m "docs: lawyer question list + phase-remapping amendment draft (§6.1, §1.4)"
```

---

## Phase 0 Exit Criteria (verify all before declaring done)

From the design §4 and normative package §5:

- [ ] At least one contract schema with a valid/invalid fixture pair: valid passes, invalid rejected, a deliberate schema break turns the test suite red (Task 2, verified in Step 10).
- [ ] boundary-check catches a deliberately-introduced boundary violation **and** a module-level mutable export — as a permanent CI step, not a one-off demo (Task 3, `pnpm run guardrails`).
- [ ] The artifact builds and comes up with one command; `/health/ready` is green against a real DB (Task 7, Step 6).
- [ ] CI runs lint + typecheck + test + build + guardrails on every PR (Task 8).
- [ ] Lawyer question list exists; amendment v1.3 draft handed to the owner (Task 9).

---

## Self-Review Notes

- **Spec coverage:** design §3 tasks 1–9 map 1:1 to Tasks 1–9; exit criteria §4 map to the checklist above. Global constraints (one lockfile, boundary-from-commit-1, no forward scaffolding, docs/sessions placement) are enforced by Tasks 1/3/5 and the file structure.
- **Deferred within accepted norms (flagged, not silent):** Prisma `multiSchema` deferred to phase 1's first model (Task 5 design note); REQ-RT-011/014/015, REQ-ID-018/019, kind-flip flow deferred via the v1.3 amendment draft (Task 9) — owner decision, not implemented silently.
- **Type consistency:** `loadConfig`/`AppConfig`, `PrismaService.isHealthy`, `HealthController.ready`, `logEventSchema`/`LogEvent`, fixture shapes are used identically across the tasks that produce and consume them.
- **Not in phase 0 (anti-forward):** no app-modules, no Prisma models, no auth/tokens, no socket.io, no OpenAPI/AsyncAPI generation, no §4 parameters beyond the minimal config.
```
