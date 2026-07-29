# Membership / guest-join — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ввести домен Membership и поток входа гостя по коду комнаты + имени, с политикой входа, лимитом участников и per-IP rate-limit (REQ-ID-002/003/006/011/013).

**Architecture:** Новая PG-схема `membership` (таблица `Membership` + частичный индекс единственного организатора), новые колонки `Room.code`/`Room.joinPolicy` и `Identity.displayName`; `IdentityService.createGuest` (первый identity-пишущий поток), `MembershipService.join` с единообразным отказом, `JoinRateLimiter` как in-memory провайдер; `RoomService.create` расширяется кодом, политикой и созданием ORGANIZER-membership в той же транзакции.

**Tech Stack:** NestJS 11, Prisma 7.8 (adapter-pg, multiSchema), zod 4, Jest + Testcontainers, dependency-cruiser.

**Design:** `docs/sessions/2026-07-29-membership-guest-join-design.md` (одобрен; решения владельца — его §1).

## Global Constraints

- **Jest CLI:** рабочая форма БЕЗ `--`: `pnpm --filter @mymozhem/core test:int -t "..."`. Форма с `--` миспарсится (`-t` становится testPathPattern).
- **Prisma-команды:** cwd = корень репозитория (обнаружение `prisma.config.ts`); `prisma generate` требует `DATABASE_URL` в окружении.
- **Хост-порт 5432 занят чужим контейнером `lt-pg`** — не трогать. Authoring-контейнер миграций — на порту 55434.
- **Docker Desktop должен быть запущен** для интеграционной ланы (контейнер Postgres на каждый describe с `startTestDb`, ~8 с на файл).
- **Миграция замораживается после слияния** — правка на месте допустима только до публикации ветки.
- **ZodError от `displayNameSchema.parse` — сознательно нетипизирован** (design §6: три кода ошибок, не четыре); маппинг — обязанность первого транспорта (REQ-SEC-006).
- **Коды ошибок core-внутренние**, не SDK-контракт; наружу не отдаются до транспорта.
- **Локальные dev-БД после Task 3:** `Room.code` NOT NULL ломает старые строки — рецепт `prisma migrate reset` (персистентных данных нет).
- Коммит-стиль: `feat(core): … (REQ-…)` / `feat(sdk): … (REQ-…)`.

## Controller notes (развилки, решённые заранее)

- **dependency-cruiser конфиг НЕ меняется.** Правила forbid-only; зависимости room → membership → identity внутри core ничто не запрещает. Design §4 говорил «отражается в конфиге boundary-check» — при чтении конфига оказалось, что отражать нечего; гейт должен просто остаться зелёным (Task 6 проверяет).
- **Алфавит кода — 31 символ** (`abcdefghjkmnpqrstuvwxyz23456789`: без `0/o`, `1/l/i`). Design §2 называет 32 — фактически 31, энтропия 8 символов ≈ 8.5×10¹¹, выводы дизайна не меняются. В плане везде точное значение.
- **Тест атомарности join «падение вставки membership не оставляет identity» (design §7) не реализуем без моков**: внутритранзакционный сбой недостижим извне (identity свежая — unique-конфликта быть не может; FK-брейк требует гонки). Замена: тест «отказ не пишет ничего» (denial-path) + атомарность по построению (один `$transaction`). Заявляется явно, чтобы ревьюер не считал это тихим пропуском.
- **Коллизия кода не тестируется** (вероятность ~10⁻¹²): retry-ветка — страховка, матчер ошибки ловит SQLSTATE `23505` по индексу `Room_code_key`.
- **RoomService.create(organizerId, joinPolicy = 'guests')** — сигнатура обратно совместима; конструктор меняется дважды (Task 3: +config; Task 4: +membership). Все call-site'ы ищутся `grep -rn "new RoomService(" packages apps` и обновляются оба раза.
- **Косметика jest.integration.config.js** (комментарий «per file» → «per describe») — в Task 3.

---

### Task 1: SDK — схемы roomJoinPolicy и displayName

**Files:**
- Create: `packages/sdk/src/membership/room-join-policy.ts`
- Create: `packages/sdk/src/membership/room-join-policy.fixtures.ts`
- Create: `packages/sdk/src/membership/room-join-policy.contract.spec.ts`
- Create: `packages/sdk/src/identity/display-name.ts`
- Create: `packages/sdk/src/identity/display-name.fixtures.ts`
- Create: `packages/sdk/src/identity/display-name.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**
- Consumes: ничего из новых задач (SDK — лист).
- Produces: `roomJoinPolicySchema`, `ROOM_JOIN_POLICIES`, тип `RoomJoinPolicy` (`'guests' | 'registered' | 'invite_only'`); `displayNameSchema`, `DISPLAY_NAME_MAX_LENGTH`, тип `DisplayName`; фикстуры `validJoinPolicies`/`invalidJoinPolicies`, `validDisplayNames`/`invalidDisplayNames`. Потребители: RoomService (Task 3), IdentityService (Task 4), MembershipService (Task 5).

- [ ] **Step 1: Написать failing контрактные тесты**

`packages/sdk/src/membership/room-join-policy.contract.spec.ts`:

```ts
import { ROOM_JOIN_POLICIES, roomJoinPolicySchema } from './room-join-policy';
import { validJoinPolicies, invalidJoinPolicies } from './room-join-policy.fixtures';

describe('roomJoinPolicy contract (REQ-ID-002)', () => {
  it('declares exactly the three policies of REQ-ID-002', () => {
    expect([...ROOM_JOIN_POLICIES]).toEqual(['guests', 'registered', 'invite_only']);
  });

  it.each(validJoinPolicies)('accepts %s', (policy) => {
    expect(roomJoinPolicySchema.safeParse(policy).success).toBe(true);
  });

  it.each(invalidJoinPolicies.map((v) => [String(v), v] as const))('rejects %s', (_name, v) => {
    expect(roomJoinPolicySchema.safeParse(v).success).toBe(false);
  });
});
```

`packages/sdk/src/identity/display-name.contract.spec.ts`:

```ts
import { DISPLAY_NAME_MAX_LENGTH, displayNameSchema } from './display-name';
import { validDisplayNames, invalidDisplayNames } from './display-name.fixtures';

describe('displayName contract (REQ-ID-003)', () => {
  it.each(validDisplayNames)('accepts %s', (name) => {
    expect(displayNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(invalidDisplayNames.map((v) => [String(v), v] as const))('rejects %s', (_name, v) => {
    expect(displayNameSchema.safeParse(v).success).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    expect(displayNameSchema.parse('  Alex  ')).toBe('Alex');
  });

  it('accepts exactly DISPLAY_NAME_MAX_LENGTH chars and rejects one more', () => {
    expect(displayNameSchema.safeParse('x'.repeat(DISPLAY_NAME_MAX_LENGTH)).success).toBe(true);
    expect(displayNameSchema.safeParse('x'.repeat(DISPLAY_NAME_MAX_LENGTH + 1)).success).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать — подтвердить RED**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: FAIL — модули `./room-join-policy`, `./display-name` не существуют.

- [ ] **Step 3: Реализовать схемы и фикстуры**

`packages/sdk/src/membership/room-join-policy.ts`:

```ts
import { z } from 'zod';

// REQ-ID-002: join policy is a room attribute, default 'guests' (ADR-004). Values are
// the lowercase spec strings; the DB enum maps to them via @map (design §2).
export const ROOM_JOIN_POLICIES = ['guests', 'registered', 'invite_only'] as const;
export const roomJoinPolicySchema = z.enum(ROOM_JOIN_POLICIES);
export type RoomJoinPolicy = z.infer<typeof roomJoinPolicySchema>;
```

`packages/sdk/src/membership/room-join-policy.fixtures.ts`:

```ts
import type { RoomJoinPolicy } from './room-join-policy';

export const validJoinPolicies: RoomJoinPolicy[] = ['guests', 'registered', 'invite_only'];

// Wrong case, unknown values, empty, non-strings — all rejected.
export const invalidJoinPolicies: unknown[] = ['GUESTS', 'Guests', 'public', '', null, 42];
```

`packages/sdk/src/identity/display-name.ts`:

```ts
import { z } from 'zod';

// Guest display name (REQ-ID-003): trimmed, 1..40 chars. PII-adjacent: it lives on the
// Identity row only and never enters event-log payloads (REQ-SEC-009).
export const DISPLAY_NAME_MAX_LENGTH = 40;
export const displayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH);
export type DisplayName = z.infer<typeof displayNameSchema>;
```

`packages/sdk/src/identity/display-name.fixtures.ts`:

```ts
export const validDisplayNames: string[] = ['Саша', 'A', '  Alex  '];

// Empty, whitespace-only (trims to empty), over the cap, non-strings — all rejected.
export const invalidDisplayNames: unknown[] = ['', '   ', 'x'.repeat(41), null, 42];
```

- [ ] **Step 4: Прогнать — GREEN**

Run: `pnpm --filter @mymozhem/sdk test`
Expected: PASS; новые 20 тестов зелёные (162 существующих не тронуты).

- [ ] **Step 5: Экспорты в index.ts**

В `packages/sdk/src/index.ts` добавить (после существующих identity/membership строк):

```ts
export * from './identity/display-name';
export * from './identity/display-name.fixtures';
export * from './membership/room-join-policy';
export * from './membership/room-join-policy.fixtures';
```

- [ ] **Step 6: Гейты пакета + commit**

Run: `pnpm --filter @mymozhem/sdk lint && pnpm --filter @mymozhem/sdk typecheck && pnpm --filter @mymozhem/sdk test`
Expected: зелёные.

```bash
git add packages/sdk
git commit -m "feat(sdk): room join policy + displayName contract schemas (REQ-ID-002, REQ-ID-003)"
```

---

### Task 2: Конфиг — параметры §4 и ConfigModule

**Files:**
- Modify: `packages/core/src/config/config.schema.ts`
- Create: `packages/core/src/config/config.tokens.ts`
- Create: `packages/core/src/config/config.module.ts`
- Modify: `packages/core/src/config/config.schema.spec.ts`

**Interfaces:**
- Consumes: существующий `loadConfig`.
- Produces: поля `ROOM_CODE_MIN_LEN: number` (дефолт 8, ≥ 6), `ROOM_PARTICIPANT_LIMIT: number` (дефолт 500, 1…100 000), `JOIN_RATE_LIMIT_IP: number` (дефолт 20, ≥ 1) на `AppConfig`; токен `APP_CONFIG: symbol`; `ConfigModule` (провайдит `APP_CONFIG` через `loadConfig(process.env)`). Потребители: RoomService (Task 3), MembershipService (Task 5).

- [ ] **Step 1: Написать failing-тесты**

Добавить в `packages/core/src/config/config.schema.spec.ts` внутрь `describe('loadConfig')`:

```ts
it('applies §4 defaults (REQ-ID-006, REQ-ID-013)', () => {
  const cfg = loadConfig({ ...base } as NodeJS.ProcessEnv);
  expect(cfg.ROOM_CODE_MIN_LEN).toBe(8);
  expect(cfg.ROOM_PARTICIPANT_LIMIT).toBe(500);
  expect(cfg.JOIN_RATE_LIMIT_IP).toBe(20);
});

it.each([
  ['ROOM_CODE_MIN_LEN', '5'],
  ['ROOM_PARTICIPANT_LIMIT', '0'],
  ['ROOM_PARTICIPANT_LIMIT', '100001'],
  ['JOIN_RATE_LIMIT_IP', '0'],
] as const)('throws when %s is out of range (%s)', (key, value) => {
  expect(() => loadConfig({ ...base, [key]: value } as NodeJS.ProcessEnv)).toThrow(
    new RegExp(key),
  );
});

it('coerces §4 params from strings', () => {
  const cfg = loadConfig({
    ...base,
    ROOM_CODE_MIN_LEN: '10',
    JOIN_RATE_LIMIT_IP: '5',
  } as NodeJS.ProcessEnv);
  expect(cfg.ROOM_CODE_MIN_LEN).toBe(10);
  expect(cfg.JOIN_RATE_LIMIT_IP).toBe(5);
});
```

- [ ] **Step 2: Прогнать — подтвердить RED**

Run: `pnpm --filter @mymozhem/core test -t "loadConfig"`
Expected: FAIL — `cfg.ROOM_CODE_MIN_LEN` is `undefined`.

- [ ] **Step 3: Реализовать**

`packages/core/src/config/config.schema.ts` — полная замена содержимого:

```ts
import { z } from 'zod';

// Startup config validation mechanism (REQ-OPS-003). §4 parameters arrive with the
// phases that need them; ranges are the hard bounds of the spec's §4 table.
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  // REQ-ID-013: room code length (§4: default 8, min 6).
  ROOM_CODE_MIN_LEN: z.coerce.number().int().min(6).default(8),
  // REQ-ID-006: max PARTICIPANT memberships per room (§4: default 500, 1..100 000).
  ROOM_PARTICIPANT_LIMIT: z.coerce.number().int().min(1).max(100_000).default(500),
  // REQ-ID-006: join attempts per minute per IP (§4: default 20, ≥ 1).
  JOIN_RATE_LIMIT_IP: z.coerce.number().int().min(1).default(20),
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

`packages/core/src/config/config.tokens.ts`:

```ts
// DI token for the validated startup config (REQ-OPS-003). Services inject AppConfig;
// nothing outside PrismaService reads process.env directly.
export const APP_CONFIG = Symbol('APP_CONFIG');
```

`packages/core/src/config/config.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { APP_CONFIG } from './config.tokens';
import { loadConfig } from './config.schema';

@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
```

- [ ] **Step 4: Прогнать — GREEN**

Run: `pnpm --filter @mymozhem/core test -t "loadConfig"`
Expected: PASS (7 тестов describe).

- [ ] **Step 5: Гейты + commit**

Run: `pnpm --filter @mymozhem/core lint && pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core test`
Expected: зелёные.

```bash
git add packages/core/src/config
git commit -m "feat(core): §4 join/code/participant config params + ConfigModule (REQ-OPS-003)"
```

---

### Task 3: Миграция membership + код комнаты и политика в RoomService.create

**Files:**
- Modify: `packages/core/prisma/schema.prisma`
- Create: `packages/core/prisma/migrations/<timestamp>_membership_guest_join/migration.sql` (генерируется `--create-only`, затем дописывается вручную)
- Create: `packages/core/src/room/room-code.ts`
- Create: `packages/core/src/room/room-code.spec.ts`
- Modify: `packages/core/src/room/room.service.ts` (create: code + joinPolicy; конструктор +config)
- Modify: `packages/core/src/room/room.module.ts` (imports ConfigModule)
- Test: `packages/core/src/membership/membership-schema.int-spec.ts` (новый файл)
- Test: `packages/core/src/room/room.service.int-spec.ts` (новый describe + обновление makeService)
- Modify: `packages/core/src/identity/identity-schema.int-spec.ts` (presence-апгрейд + кросс-kind)
- Modify: `packages/core/src/testing/harness.int-spec.ts` (code в create, seed с email)
- Modify: `packages/core/jest.integration.config.js` (косметика комментария)

**Interfaces:**
- Consumes: `roomJoinPolicySchema`/`RoomJoinPolicy` (Task 1), `APP_CONFIG`/`ConfigModule`/`AppConfig` (Task 2).
- Produces: Prisma-модели `Membership`, enum'ы `MemberRole`/`RoomJoinPolicy`, поля `Room.code: string`, `Room.joinPolicy: $Enums.RoomJoinPolicy`, `Identity.displayName: string | null`; `generateRoomCode(length: number): string`, `ROOM_CODE_ALPHABET: string`, `isRoomCodeCollision(e: unknown): boolean`; `RoomService.create(organizerId: string, joinPolicy?: RoomJoinPolicy): Promise<Room>`. На код опираются Tasks 4–5.

- [ ] **Step 1: Написать failing unit-тест генератора кода**

`packages/core/src/room/room-code.spec.ts`:

```ts
import { generateRoomCode, ROOM_CODE_ALPHABET } from './room-code';

describe('generateRoomCode (REQ-ID-013)', () => {
  it('produces a code of the requested length from the safe alphabet only', () => {
    const code = generateRoomCode(8);
    expect(code).toHaveLength(8);
    for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
  });

  it('excludes confusable characters by construction (no 0/o, 1/l/i)', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01ilo]/);
  });

  it('respects other lengths', () => {
    expect(generateRoomCode(12)).toHaveLength(12);
  });
});
```

Run: `pnpm --filter @mymozhem/core test -t "generateRoomCode"`
Expected: FAIL — модуль `./room-code` не существует.

- [ ] **Step 2: Написать failing интеграционные тесты схемы и create**

Новый `packages/core/src/membership/membership-schema.int-spec.ts`:

```ts
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';

const ORG = '00000000-0000-0000-0000-000000000001';

// REQ-ID-011 + REQ-DEV-006: таблица membership и частичный индекс единственного
// организатора существуют и ведут себя как специфицировано (design §2).
describe('Membership schema', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE membership."Membership", room."Room" CASCADE',
    );
  });

  const createRoom = (code: string) =>
    db.prisma.room.create({ data: { organizerId: ORG, code } });

  it('single-organizer partial unique index exists (REQ-DEV-006 presence test)', async () => {
    const rows = await db.prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'membership' AND indexname = 'Membership_single_organizer_key'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/^CREATE UNIQUE INDEX/);
    expect(rows[0].indexdef).toContain('"roomId"');
    expect(rows[0].indexdef).toMatch(/role = 'ORGANIZER'/);
  });

  it('enforces one ORGANIZER per room at the database level', async () => {
    const room = await createRoom('testcode1');
    const guest = await seedIdentity(db.prisma, { kind: 'GUEST' });
    await db.prisma.membership.create({
      data: { roomId: room.id, identityId: ORG, role: 'ORGANIZER' },
    });
    await expect(
      db.prisma.membership.create({
        data: { roomId: room.id, identityId: guest.id, role: 'ORGANIZER' },
      }),
    ).rejects.toThrow(/[Uu]nique constraint|duplicate key/);
  });

  it('allows a second ORGANIZER membership in a DIFFERENT room', async () => {
    const roomA = await createRoom('testcode1');
    const roomB = await createRoom('testcode2');
    await db.prisma.membership.create({
      data: { roomId: roomA.id, identityId: ORG, role: 'ORGANIZER' },
    });
    await db.prisma.membership.create({
      data: { roomId: roomB.id, identityId: ORG, role: 'ORGANIZER' },
    });
    expect(await db.prisma.membership.count()).toBe(2);
  });

  it('enforces unique(roomId, identityId)', async () => {
    const room = await createRoom('testcode1');
    const guest = await seedIdentity(db.prisma, { kind: 'GUEST' });
    await db.prisma.membership.create({
      data: { roomId: room.id, identityId: guest.id, role: 'PARTICIPANT' },
    });
    await expect(
      db.prisma.membership.create({
        data: { roomId: room.id, identityId: guest.id, role: 'SPECTATOR' },
      }),
    ).rejects.toThrow(/[Uu]nique constraint|duplicate key/);
  });

  it('enforces unique room codes', async () => {
    await createRoom('testcode1');
    await expect(createRoom('testcode1')).rejects.toThrow(
      /[Uu]nique constraint|duplicate key/,
    );
  });
});
```

Новый describe в конец `packages/core/src/room/room.service.int-spec.ts` (makeService обновляется в Step 6 — на этом шаге тесты падают и по схеме, и по сигнатуре):

```ts
describe('RoomService.create room code and join policy (REQ-ID-013, REQ-ID-002)', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    service = makeService(db);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  it('creates a room with an 8-char safe-alphabet code and guests policy by default', async () => {
    const room = await service.create(ORG);
    expect(room.code).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
    expect(room.joinPolicy).toBe('GUESTS');
  });

  it('generates distinct codes for two rooms', async () => {
    const a = await service.create(ORG);
    const b = await service.create(ORG);
    expect(a.code).not.toBe(b.code);
  });

  it('honours an explicit join policy', async () => {
    const room = await service.create(ORG, 'registered');
    expect(room.joinPolicy).toBe('REGISTERED');
  });

  it('rejects an invalid join policy before touching the DB', async () => {
    await expect(service.create(ORG, 'public' as never)).rejects.toThrow();
  });
});
```

Апгрейд presence-теста в `packages/core/src/identity/identity-schema.int-spec.ts` (follow-up identity-пакета): в первый тест (`exists in the migrated database`) добавить два ассерта после `expect(rows).toHaveLength(1)`:

```ts
    expect(rows[0].indexdef).toMatch(/^CREATE UNIQUE INDEX/);
    expect(rows[0].indexdef).toContain('lower("email")');
```

И новый кросс-kind тест в тот же describe:

```ts
  it('allows a GUEST row with the email of a live REGISTERED row', async () => {
    await db.prisma.identity.create({ data: { kind: 'REGISTERED', email: 'a@b.c' } });
    await db.prisma.identity.create({ data: { kind: 'GUEST', email: 'a@b.c' } });
    expect(await db.prisma.identity.count()).toBe(2);
  });
```

- [ ] **Step 3: Прогнать интеграционные — подтвердить RED**

Run: `pnpm --filter @mymozhem/core test:int -t "Membership schema"`
Expected: FAIL — `schema membership does not exist` / Prisma validation (модели нет).

- [ ] **Step 4: Обновить schema.prisma**

В `packages/core/prisma/schema.prisma`:

1. `datasource.schemas` → `["identity", "membership", "realtime", "room"]`.
2. В модель `Room` добавить поля `code`, `joinPolicy` и релейшн `memberships`; полный вид:

```prisma
model Room {
  id              String         @id @default(uuid()) @db.Uuid
  organizer       Identity       @relation(fields: [organizerId], references: [id])
  organizerId     String         @db.Uuid
  status          RoomStatus     @default(DRAFT)
  code            String         @unique
  joinPolicy      RoomJoinPolicy @default(GUESTS)
  appId           String?
  manifestVersion Int?
  appSettings     Json?
  deletedAt       DateTime?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  logEvents       LogEvent[]
  memberships     Membership[]

  @@schema("room")
}
```

3. После enum `RoomStatus` добавить:

```prisma
// REQ-ID-002: join policy — атрибут комнаты, дефолт guests (ADR-004). Значения в БД —
// lowercase-строки спеки (прецедент EventVisibility); Prisma-имена — как у MemberRole.
enum RoomJoinPolicy {
  GUESTS      @map("guests")
  REGISTERED  @map("registered")
  INVITE_ONLY @map("invite_only")

  @@schema("room")
}
```

4. В модель `Identity` добавить `displayName String?` (после `email`) и релейшн `memberships Membership[]` (после `logEvents`).
5. В конец файла добавить:

```prisma
enum MemberRole {
  ORGANIZER
  MODERATOR
  PARTICIPANT
  SPECTATOR

  @@schema("membership")
}

// Membership — связь identity с комнатой, несущая роль (REQ-ID-011). CRUD-домен
// (ADR-005): изменения членства в лог не пишутся. ORGANIZER-membership создаётся в
// транзакции RoomService.create; единственность организатора — частичный индекс
// "Membership_single_organizer_key" (рукописная часть миграции, REQ-DEV-006).
model Membership {
  id         String    @id @default(uuid()) @db.Uuid
  room       Room      @relation(fields: [roomId], references: [id], onDelete: Restrict)
  roomId     String    @db.Uuid
  identity   Identity  @relation(fields: [identityId], references: [id], onDelete: Restrict)
  identityId String    @db.Uuid
  role       MemberRole
  joinedAt   DateTime  @default(now())

  @@unique([roomId, identityId])
  @@schema("membership")
}
```

- [ ] **Step 5: Сгенерировать миграцию (--create-only), дописать индекс, применить**

Run (cwd = корень):

```bash
docker run -d --name mm-migrate -e POSTGRES_PASSWORD=postgres -p 55434:5432 postgres:17
until docker exec mm-migrate pg_isready -U postgres | grep -q "accepting connections"; do sleep 1; done
DATABASE_URL=postgresql://postgres:postgres@localhost:55434/postgres pnpm exec prisma migrate dev --name membership_guest_join --create-only
```

Expected: создана `packages/core/prisma/migrations/<timestamp>_membership_guest_join/migration.sql` (CreateSchema membership, два enum, CreateTable Membership, ALTER Room/Identity, FK, unique-индексы). Миграция НЕ применена.

Дописать в конец сгенерированного `migration.sql`:

```sql
-- Рукописная часть (практика REQ-DEV-006): ровно один ORGANIZER-membership на
-- комнату (design §2). PARTICIPANT/SPECTATOR/MODERATOR не ограничиваются.
CREATE UNIQUE INDEX "Membership_single_organizer_key"
  ON "membership"."Membership" ("roomId")
  WHERE "role" = 'ORGANIZER';
```

Применить и сгенерировать клиент (cwd = корень; явный generate — `migrate dev` не всегда регенерирует):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:55434/postgres pnpm exec prisma migrate dev
DATABASE_URL=postgresql://postgres:postgres@localhost:55434/postgres pnpm exec prisma generate
docker rm -f mm-migrate
```

Expected: `Applying migration ... membership_guest_join` чисто; клиент видит `prisma.membership`, `Room.code`, `Identity.displayName`.

- [ ] **Step 6: Реализовать room-code.ts и обновить RoomService.create + makeService**

Новый `packages/core/src/room/room-code.ts`:

```ts
import { randomInt } from 'node:crypto';

// REQ-ID-013: cryptographically random room code; alphabet excludes confusable
// characters (no 0/o, 1/l/i) — 31 chars, 8 chars ≈ 8.5e11 combinations. Length comes
// from ROOM_CODE_MIN_LEN (config §4), never a literal.
export const ROOM_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateRoomCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

// Unique violation on the room code (index "Room_code_key"). Driver-adapter raw
// errors surface the Postgres SQLSTATE; the retry loop in create() is a safety net —
// a collision is a ~1e-12 event and intentionally untested.
export function isRoomCodeCollision(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return (
    err?.code === '23505' &&
    typeof err.message === 'string' &&
    err.message.includes('Room_code_key')
  );
}
```

В `packages/core/src/room/room.service.ts`:

- Импорты: добавить `Inject` к `@nestjs/common`; добавить
  `import { roomJoinPolicySchema, type RoomJoinPolicy } from '@mymozhem/sdk';` (к существующему SDK-импорту — type-импорт `CoreEventName` уже есть, объединить),
  `import { APP_CONFIG } from '../config/config.tokens';`,
  `import type { AppConfig } from '../config/config.schema';`,
  `import { generateRoomCode, isRoomCodeCollision } from './room-code';`.
- Конструктор:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLog: EventLogService,
    private readonly appRegistry: AppRegistryService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
```

- `create` — полная замена метода:

```ts
  async create(organizerId: string, joinPolicy: RoomJoinPolicy = 'guests'): Promise<Room> {
    const policy = roomJoinPolicySchema.parse(joinPolicy);
    // Retry on code collision lives OUTSIDE any transaction: a failed statement aborts
    // the whole Postgres transaction, so retrying inside one is pointless.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateRoomCode(this.config.ROOM_CODE_MIN_LEN);
      try {
        return await this.insertRoom(organizerId, code, policy);
      } catch (e) {
        if (attempt < 2 && isRoomCodeCollision(e)) continue;
        throw e;
      }
    }
    throw new Error('unreachable: the retry loop exits via return or throw');
  }

  // REQ-ID-005: organizer must be a live REGISTERED identity. One atomic guarded
  // INSERT — the WHERE EXISTS predicate is the single source of truth, no
  // check-before-write (same philosophy as the guarded UPDATEs below). Race-safe
  // structurally: in phase 1 kind is immutable, later flips go GUEST→REGISTERED
  // only (REQ-ID-004), and no flow sets deletedAt on REGISTERED (design §3).
  // The same predicate lives in the "Identity_registered_email_key" index
  // condition (design §7) — change both or neither.
  // `updatedAt` is explicit: Prisma's @updatedAt is client-side, no DB default.
  private async insertRoom(
    organizerId: string,
    code: string,
    joinPolicy: RoomJoinPolicy,
  ): Promise<Room> {
    const rows = await this.prisma.$queryRaw<Room[]>`
      INSERT INTO room."Room" ("id", "organizerId", "status", "code", "joinPolicy", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), ${organizerId}::uuid, 'DRAFT', ${code}, ${joinPolicy}::"room"."RoomJoinPolicy", now(), now()
      WHERE EXISTS (
        SELECT 1 FROM identity."Identity"
        WHERE "id" = ${organizerId}::uuid
          AND "kind" = 'REGISTERED'
          AND "deletedAt" IS NULL
      )
      RETURNING *
    `;
    if (rows.length === 0) {
      throw new RoomOrganizerNotRegisteredError(
        `Organizer ${organizerId} is not a live REGISTERED identity`,
      );
    }
    return rows[0];
  }
```

В `packages/core/src/room/room.module.ts` — добавить ConfigModule:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AppRegistryModule } from '../app-registry/app-registry.module';
import { ConfigModule } from '../config/config.module';
import { RoomService } from './room.service';

@Module({
  imports: [PrismaModule, RealtimeModule, AppRegistryModule, ConfigModule],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}
```

Обновить `makeService` в `packages/core/src/room/room.service.int-spec.ts` (и любые другие call-site'ы `new RoomService(` — найти `grep -rn "new RoomService(" packages apps`):

```ts
import type { AppConfig } from '../config/config.schema';

const TEST_CONFIG: AppConfig = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://unused',
  ROOM_CODE_MIN_LEN: 8,
  ROOM_PARTICIPANT_LIMIT: 500,
  JOIN_RATE_LIMIT_IP: 20,
};

const makeService = (db: TestDb) =>
  new RoomService(
    db.prisma,
    new EventLogService(),
    new AppRegistryService([validManifests[0]]),
    TEST_CONFIG,
  );
```

- [ ] **Step 7: Починить harness.int-spec.ts и косметику jest-конфига (follow-up)**

`packages/core/src/testing/harness.int-spec.ts` — seed с email и код в create:

```ts
    db = await startTestDb();
    await seedIdentity(db.prisma, {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'harness@example.test',
    });
```

```ts
    const created = await db.prisma.room.create({
      data: { organizerId: '00000000-0000-0000-0000-000000000001', code: 'harness01' },
    });
```

`packages/core/jest.integration.config.js` — комментарий к `maxWorkers`:

```js
  maxWorkers: 1, // one container per describe block (startTestDb); avoid parallel DB contention
```

- [ ] **Step 8: Прогнать тесты — GREEN**

Run:

```bash
pnpm --filter @mymozhem/core test -t "generateRoomCode"
pnpm --filter @mymozhem/core test:int -t "Membership schema"
pnpm --filter @mymozhem/core test:int -t "room code and join policy"
pnpm --filter @mymozhem/core test:int -t "partial unique index"
pnpm --filter @mymozhem/core test:int
```

Expected: все зелёные; полная лана без регрессий (существующие room/identity/realtime спеки проходят с новым конструктором и схемой).

- [ ] **Step 9: Commit**

```bash
git add packages/core/prisma packages/core/src packages/core/jest.integration.config.js
git commit -m "feat(core): membership schema + room code & join policy in create (REQ-ID-013, REQ-ID-002, REQ-ID-011)"
```

---

### Task 4: IdentityService.createGuest + ORGANIZER-membership при создании комнаты

**Files:**
- Create: `packages/core/src/identity/identity.service.ts`
- Create: `packages/core/src/identity/identity.module.ts`
- Create: `packages/core/src/membership/membership.service.ts`
- Create: `packages/core/src/membership/membership.module.ts`
- Modify: `packages/core/src/room/room.service.ts` (транзакция create + membership)
- Modify: `packages/core/src/room/room.module.ts` (imports MembershipModule)
- Test: `packages/core/src/identity/identity.service.int-spec.ts` (новый)
- Test: `packages/core/src/room/room.service.int-spec.ts` (ассерт ORGANIZER-membership + обновление makeService)

**Interfaces:**
- Consumes: `displayNameSchema` (Task 1), `APP_CONFIG` (Task 2), схема membership (Task 3).
- Produces: `IdentityService.createGuest(displayName: string, tx?: Prisma.TransactionClient): Promise<Identity>`; `MembershipService.createOrganizerMembership(tx: Prisma.TransactionClient, roomId: string, identityId: string): Promise<Membership>`; `IdentityModule`, `MembershipModule`. Потребитель: MembershipService.join (Task 5) использует `createGuest` с `tx`.

- [ ] **Step 1: Написать failing-тесты**

Новый `packages/core/src/identity/identity.service.int-spec.ts`:

```ts
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { IdentityService } from './identity.service';

// REQ-ID-003: гость создаётся по коду комнаты и имени; этот сервис — первый
// identity-пишущий поток (identity seam design §6).
describe('IdentityService.createGuest (REQ-ID-003)', () => {
  let db: TestDb;
  let service: IdentityService;

  beforeAll(async () => {
    db = await startTestDb();
    service = new IdentityService(db.prisma);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE identity."Identity" CASCADE');
  });

  it('creates a GUEST identity with a trimmed display name', async () => {
    const guest = await service.createGuest('  Саша  ');
    expect(guest.kind).toBe('GUEST');
    expect(guest.displayName).toBe('Саша');
    expect(guest.email).toBeNull();
    expect(guest.deletedAt).toBeNull();
  });

  it('rejects an empty-after-trim name', async () => {
    await expect(service.createGuest('   ')).rejects.toThrow();
  });

  it('rejects a name over 40 chars', async () => {
    await expect(service.createGuest('x'.repeat(41))).rejects.toThrow();
  });
});
```

В `packages/core/src/room/room.service.int-spec.ts`, в describe `RoomService lifecycle`, добавить:

```ts
  it('creates the ORGANIZER membership atomically with the room (REQ-ID-011, design §1)', async () => {
    const room = await service.create(ORG);
    const memberships = await db.prisma.membership.findMany({ where: { roomId: room.id } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].identityId).toBe(ORG);
    expect(memberships[0].role).toBe('ORGANIZER');
  });
```

- [ ] **Step 2: Прогнать — подтвердить RED**

Run: `pnpm --filter @mymozhem/core test:int -t "createGuest"`
Expected: FAIL — `./identity.service` не существует (компиляция спеки падает).

- [ ] **Step 3: Реализовать IdentityService + IdentityModule**

`packages/core/src/identity/identity.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Identity, Prisma } from '@prisma/client';
import { displayNameSchema } from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  // REQ-ID-003: a guest is created by room code + name. This is the first
  // identity-writing flow — the identity seam deferred this service to exactly here
  // (design §6 of the identity slice). displayName is validated by the SDK contract
  // schema; a ZodError propagates untyped — mapping it is the first transport's job
  // (REQ-SEC-006). `tx` lets callers join their transaction (guest join is atomic,
  // membership design §3).
  async createGuest(
    displayName: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Identity> {
    const name = displayNameSchema.parse(displayName);
    return tx.identity.create({ data: { kind: 'GUEST', displayName: name } });
  }
}
```

`packages/core/src/identity/identity.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { IdentityService } from './identity.service';

@Module({
  imports: [PrismaModule],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
```

- [ ] **Step 4: Реализовать MembershipService (пока только createOrganizerMembership) + MembershipModule**

`packages/core/src/membership/membership.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Membership, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  // Called by RoomService.create inside its transaction: the organizer becomes the
  // room's first member (design §1). A violation of the partial unique index
  // "Membership_single_organizer_key" rolls the room insert back too.
  async createOrganizerMembership(
    tx: Prisma.TransactionClient,
    roomId: string,
    identityId: string,
  ): Promise<Membership> {
    return tx.membership.create({
      data: { roomId, identityId, role: 'ORGANIZER' },
    });
  }
}
```

`packages/core/src/membership/membership.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MembershipService } from './membership.service';

@Module({
  imports: [PrismaModule],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
```

- [ ] **Step 5: RoomService.create — транзакция с ORGANIZER-membership**

В `packages/core/src/room/room.service.ts`:

- Импорт: `import { MembershipService } from '../membership/membership.service';`
- Конструктор (membership ПЕРЕД config):

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLog: EventLogService,
    private readonly appRegistry: AppRegistryService,
    private readonly membership: MembershipService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
```

- Тело цикла в `create` — транзакция; `insertRoom` принимает `tx`:

```ts
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateRoomCode(this.config.ROOM_CODE_MIN_LEN);
      try {
        return await this.prisma.$transaction(async (tx) => {
          const room = await this.insertRoom(tx, organizerId, code, policy);
          await this.membership.createOrganizerMembership(tx, room.id, organizerId);
          return room;
        });
      } catch (e) {
        if (attempt < 2 && isRoomCodeCollision(e)) continue;
        throw e;
      }
    }
```

- Сигнатура `insertRoom` и его `$queryRaw` через `tx`:

```ts
  private async insertRoom(
    tx: Prisma.TransactionClient,
    organizerId: string,
    code: string,
    joinPolicy: RoomJoinPolicy,
  ): Promise<Room> {
    const rows = await tx.$queryRaw<Room[]>`
      INSERT INTO room."Room" ("id", "organizerId", "status", "code", "joinPolicy", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), ${organizerId}::uuid, 'DRAFT', ${code}, ${joinPolicy}::"room"."RoomJoinPolicy", now(), now()
      WHERE EXISTS (
        SELECT 1 FROM identity."Identity"
        WHERE "id" = ${organizerId}::uuid
          AND "kind" = 'REGISTERED'
          AND "deletedAt" IS NULL
      )
      RETURNING *
    `;
    if (rows.length === 0) {
      throw new RoomOrganizerNotRegisteredError(
        `Organizer ${organizerId} is not a live REGISTERED identity`,
      );
    }
    return rows[0];
  }
```

(Импорт `Prisma` из `@prisma/client` в room.service.ts уже есть — type-only.)

`packages/core/src/room/room.module.ts` — добавить MembershipModule в imports:

```ts
  imports: [PrismaModule, RealtimeModule, AppRegistryModule, ConfigModule, MembershipModule],
```

Обновить `makeService` в room.service.int-spec.ts (и все call-site'ы `new RoomService(`):

```ts
const makeService = (db: TestDb) =>
  new RoomService(
    db.prisma,
    new EventLogService(),
    new AppRegistryService([validManifests[0]]),
    new MembershipService(db.prisma),
    TEST_CONFIG,
  );
```

- [ ] **Step 6: Прогнать — GREEN**

Run:

```bash
pnpm --filter @mymozhem/core test:int -t "createGuest"
pnpm --filter @mymozhem/core test:int -t "ORGANIZER membership"
pnpm --filter @mymozhem/core test:int
```

Expected: зелёные, полная лана без регрессий.

- [ ] **Step 7: Гейты + commit**

Run: `pnpm --filter @mymozhem/core lint && pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core test`
Expected: зелёные.

```bash
git add packages/core/src
git commit -m "feat(core): IdentityService.createGuest + organizer membership on room create (REQ-ID-003, REQ-ID-011)"
```

---

### Task 5: JoinRateLimiter + MembershipService.join

**Files:**
- Create: `packages/core/src/membership/membership.errors.ts`
- Create: `packages/core/src/membership/join-rate-limiter.ts`
- Create: `packages/core/src/membership/join-rate-limiter.spec.ts`
- Modify: `packages/core/src/membership/membership.service.ts` (join + новый конструктор)
- Modify: `packages/core/src/membership/membership.module.ts` (IdentityModule, фабрика лимитера, ConfigModule)
- Test: `packages/core/src/membership/membership.service.int-spec.ts` (новый)

**Interfaces:**
- Consumes: `IdentityService.createGuest(name, tx)` (Task 4), `AppConfig`/`APP_CONFIG`/`ConfigModule` (Task 2), `RoomService.create(organizerId, policy?)` (Task 3–4), `displayNameSchema` (Task 1).
- Produces: `MembershipService.join(params: { code: string; displayName: string; ip: string }): Promise<JoinResult>` (`JoinResult = { membership: Membership; identity: Identity }`); `JoinRateLimiter` с `tryAcquire(ip: string): boolean` (конструктор `(limit: number, windowMs?: number, now?: () => number)`); ошибки `RoomJoinDeniedError`/`JoinRateLimitedError`/`RoomParticipantLimitReachedError` с кодами `ROOM_JOIN_DENIED`/`JOIN_RATE_LIMITED`/`ROOM_PARTICIPANT_LIMIT_REACHED`.

- [ ] **Step 1: Написать failing unit-тесты лимитера**

`packages/core/src/membership/join-rate-limiter.spec.ts`:

```ts
import { JoinRateLimiter } from './join-rate-limiter';

describe('JoinRateLimiter (REQ-ID-006)', () => {
  it('allows up to the limit within a window, then refuses', () => {
    const now = { t: 1_000_000 };
    const limiter = new JoinRateLimiter(2, 60_000, () => now.t);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(false);
  });

  it('tracks IPs independently', () => {
    const limiter = new JoinRateLimiter(1, 60_000);
    expect(limiter.tryAcquire('1.1.1.1')).toBe(true);
    expect(limiter.tryAcquire('2.2.2.2')).toBe(true);
    expect(limiter.tryAcquire('1.1.1.1')).toBe(false);
  });

  it('resets after the window elapses', () => {
    const now = { t: 1_000_000 };
    const limiter = new JoinRateLimiter(1, 60_000, () => now.t);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
    expect(limiter.tryAcquire('1.2.3.4')).toBe(false);
    now.t += 60_001;
    expect(limiter.tryAcquire('1.2.3.4')).toBe(true);
  });
});
```

Run: `pnpm --filter @mymozhem/core test -t "JoinRateLimiter"`
Expected: FAIL — модуль не существует.

- [ ] **Step 2: Реализовать лимитер**

`packages/core/src/membership/join-rate-limiter.ts`:

```ts
// Per-IP fixed-window limiter for room-join attempts (REQ-ID-006, join_rate_limit_ip).
// State lives in the provider instance field, NOT module-level (REQ-CORE-004's eslint
// gate passes); a single replica (REQ-OPS-005) makes in-memory correct; a restart
// resets the 60s window — acceptable (design §4). The phase-4 global backoff layer
// (REQ-ID-019, amendment v1.3) will sit behind this same interface.
// Map growth: one entry per distinct IP per process lifetime — negligible at MVP scale.
export class JoinRateLimiter {
  private readonly attempts = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  // Records the attempt and returns whether it is allowed. Called BEFORE any room
  // lookup (design §3): brute-force attempts against wrong codes accumulate too.
  tryAcquire(ip: string): boolean {
    const now = this.now();
    const entry = this.attempts.get(ip);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.attempts.set(ip, { windowStart: now, count: 1 });
      return true;
    }
    if (entry.count >= this.limit) {
      return false;
    }
    entry.count += 1;
    return true;
  }
}
```

Run: `pnpm --filter @mymozhem/core test -t "JoinRateLimiter"`
Expected: PASS (3 теста).

- [ ] **Step 3: Написать failing интеграционные тесты join**

Новый `packages/core/src/membership/membership.service.int-spec.ts`:

```ts
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import type { AppConfig } from '../config/config.schema';
import { EventLogService } from '../realtime/event-log.service';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { RoomService } from '../room/room.service';
import { IdentityService } from '../identity/identity.service';
import { MembershipService } from './membership.service';
import { JoinRateLimiter } from './join-rate-limiter';
import {
  JoinRateLimitedError,
  RoomJoinDeniedError,
  RoomParticipantLimitReachedError,
} from './membership.errors';

const ORG = '00000000-0000-0000-0000-000000000001';
const IP = '203.0.113.7';
const IP2 = '198.51.100.9';

const TEST_CONFIG: AppConfig = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://unused',
  ROOM_CODE_MIN_LEN: 8,
  ROOM_PARTICIPANT_LIMIT: 500,
  JOIN_RATE_LIMIT_IP: 20,
};

describe('MembershipService.join (REQ-ID-002/003/006/013)', () => {
  let db: TestDb;
  let roomService: RoomService;

  const makeMembership = (overrides: { participantLimit?: number; rateLimit?: number } = {}) =>
    new MembershipService(
      db.prisma,
      new IdentityService(db.prisma),
      new JoinRateLimiter(overrides.rateLimit ?? 1000),
      { ...TEST_CONFIG, ROOM_PARTICIPANT_LIMIT: overrides.participantLimit ?? 500 },
    );

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    roomService = new RoomService(
      db.prisma,
      new EventLogService(),
      new AppRegistryService([]),
      new MembershipService(
        db.prisma,
        new IdentityService(db.prisma),
        new JoinRateLimiter(1000),
        TEST_CONFIG,
      ),
      TEST_CONFIG,
    );
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE membership."Membership", room."Room" CASCADE',
    );
  });

  it('joins a DRAFT room by code + name (REQ-ID-003)', async () => {
    const room = await roomService.create(ORG);
    const result = await makeMembership().join({ code: room.code, displayName: 'Саша', ip: IP });
    expect(result.identity.kind).toBe('GUEST');
    expect(result.identity.displayName).toBe('Саша');
    expect(result.membership.roomId).toBe(room.id);
    expect(result.membership.identityId).toBe(result.identity.id);
    expect(result.membership.role).toBe('PARTICIPANT');
  });

  it('joins an ACTIVE room (late-join, ADR-005)', async () => {
    const room = await roomService.create(ORG);
    await db.prisma.room.update({ where: { id: room.id }, data: { status: 'ACTIVE' } });
    const result = await makeMembership().join({ code: room.code, displayName: 'A', ip: IP });
    expect(result.membership.role).toBe('PARTICIPANT');
  });

  it('rejects an invalid display name before any write', async () => {
    const room = await roomService.create(ORG);
    await expect(
      makeMembership().join({ code: room.code, displayName: '', ip: IP }),
    ).rejects.toThrow();
    // Только ORGANIZER-membership от create; гостевая запись не появилась.
    expect(await db.prisma.membership.count({ where: { roomId: room.id } })).toBe(1);
  });

  // REQ-ID-013 exit criterion: all branches below collapse into the same typed refusal.
  it.each([
    'unknown code',
    'registered policy',
    'invite_only policy',
    'COMPLETED room',
    'CANCELLED room',
    'soft-deleted room',
  ])('refuses %s with the same ROOM_JOIN_DENIED', async (scenario) => {
    const room = await roomService.create(ORG);
    let code = room.code;
    switch (scenario) {
      case 'unknown code':
        code = 'zzzzzzzz';
        break;
      case 'registered policy':
        await db.prisma.room.update({ where: { id: room.id }, data: { joinPolicy: 'REGISTERED' } });
        break;
      case 'invite_only policy':
        await db.prisma.room.update({ where: { id: room.id }, data: { joinPolicy: 'INVITE_ONLY' } });
        break;
      case 'COMPLETED room':
        await db.prisma.room.update({ where: { id: room.id }, data: { status: 'COMPLETED' } });
        break;
      case 'CANCELLED room':
        await db.prisma.room.update({ where: { id: room.id }, data: { status: 'CANCELLED' } });
        break;
      case 'soft-deleted room':
        await db.prisma.room.update({ where: { id: room.id }, data: { deletedAt: new Date() } });
        break;
    }
    const err = await makeMembership()
      .join({ code, displayName: 'A', ip: IP })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoomJoinDeniedError);
    expect((err as RoomJoinDeniedError).code).toBe('ROOM_JOIN_DENIED');
  });

  it('writes nothing on denial', async () => {
    const guestsBefore = await db.prisma.identity.count({ where: { kind: 'GUEST' } });
    await expect(
      makeMembership().join({ code: 'zzzzzzzz', displayName: 'A', ip: IP }),
    ).rejects.toThrow(RoomJoinDeniedError);
    expect(await db.prisma.identity.count({ where: { kind: 'GUEST' } })).toBe(guestsBefore);
    expect(await db.prisma.membership.count()).toBe(0);
  });

  it('refuses a join at the participant limit with ROOM_PARTICIPANT_LIMIT_REACHED', async () => {
    const room = await roomService.create(ORG);
    const service = makeMembership({ participantLimit: 1 });
    await service.join({ code: room.code, displayName: 'A', ip: IP });
    const err = await service
      .join({ code: room.code, displayName: 'B', ip: IP2 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoomParticipantLimitReachedError);
    expect((err as RoomParticipantLimitReachedError).code).toBe(
      'ROOM_PARTICIPANT_LIMIT_REACHED',
    );
  });

  it('does not count the ORGANIZER membership toward the participant limit', async () => {
    const room = await roomService.create(ORG); // создаёт ORGANIZER-membership
    const result = await makeMembership({ participantLimit: 1 }).join({
      code: room.code,
      displayName: 'A',
      ip: IP,
    });
    expect(result.membership.role).toBe('PARTICIPANT');
  });

  it('refuses the (limit+1)-th attempt from one IP with JOIN_RATE_LIMITED', async () => {
    const room = await roomService.create(ORG);
    const service = makeMembership({ rateLimit: 2 });
    await service.join({ code: room.code, displayName: 'A', ip: IP });
    await service.join({ code: room.code, displayName: 'B', ip: IP });
    const err = await service
      .join({ code: room.code, displayName: 'C', ip: IP })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JoinRateLimitedError);
    expect((err as JoinRateLimitedError).code).toBe('JOIN_RATE_LIMITED');
  });

  it('counts attempts BEFORE the room lookup (brute force accumulates)', async () => {
    const service = makeMembership({ rateLimit: 2 });
    await expect(service.join({ code: 'zzzzzzzz', displayName: 'A', ip: IP })).rejects.toThrow(
      RoomJoinDeniedError,
    );
    await expect(service.join({ code: 'yyyyyyyy', displayName: 'A', ip: IP })).rejects.toThrow(
      RoomJoinDeniedError,
    );
    const err = await service
      .join({ code: 'xxxxxxxx', displayName: 'A', ip: IP })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JoinRateLimitedError);
  });

  it('does not throttle other IPs', async () => {
    const room = await roomService.create(ORG);
    const service = makeMembership({ rateLimit: 1 });
    await service.join({ code: room.code, displayName: 'A', ip: IP });
    const other = await service.join({ code: room.code, displayName: 'B', ip: IP2 });
    expect(other.membership.role).toBe('PARTICIPANT');
  });
});
```

- [ ] **Step 4: Прогнать — подтвердить RED**

Run: `pnpm --filter @mymozhem/core test:int -t "MembershipService.join"`
Expected: FAIL — `./membership.errors` не существует / `join` не функция.

- [ ] **Step 5: Реализовать ошибки, join, модуль**

`packages/core/src/membership/membership.errors.ts`:

```ts
// Core-internal typed domain errors for membership. NOT part of the SDK contract.
// The first transport maps them to typed responses without stack traces (REQ-SEC-006).
export const MEMBERSHIP_ERROR_CODES = {
  ROOM_JOIN_DENIED: 'ROOM_JOIN_DENIED',
  JOIN_RATE_LIMITED: 'JOIN_RATE_LIMITED',
  ROOM_PARTICIPANT_LIMIT_REACHED: 'ROOM_PARTICIPANT_LIMIT_REACHED',
} as const;

export type MembershipErrorCode =
  (typeof MEMBERSHIP_ERROR_CODES)[keyof typeof MEMBERSHIP_ERROR_CODES];

export class MembershipError extends Error {
  constructor(
    readonly code: MembershipErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

// Единообразный отказ входа (REQ-ID-013): ветки «неверный код», «комната удалена»,
// «терминальный статус», «закрытая политика» свёрнуты в один код — до установления
// членства ответ не раскрывает ни существование комнаты, ни её политику, ни статус
// (design §3). Server-side message может быть точным — наружу он не уходит.
export class RoomJoinDeniedError extends MembershipError {
  constructor(message: string) {
    super(MEMBERSHIP_ERROR_CODES.ROOM_JOIN_DENIED, message);
  }
}

// Превышен per-IP лимит попыток входа (REQ-ID-006). Отдельный код: он про IP, не про
// комнату — существование комнаты не раскрывает (design §3).
export class JoinRateLimitedError extends MembershipError {
  constructor(message: string) {
    super(MEMBERSHIP_ERROR_CODES.JOIN_RATE_LIMITED, message);
  }
}

// Комната заполнена (REQ-ID-006, room_participant_limit). Отдельный код — решение
// владельца (design §1, развилка (а)): «комната заполнена» actionable для организатора.
export class RoomParticipantLimitReachedError extends MembershipError {
  constructor(message: string) {
    super(MEMBERSHIP_ERROR_CODES.ROOM_PARTICIPANT_LIMIT_REACHED, message);
  }
}
```

`packages/core/src/membership/membership.service.ts` — полная замена:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Identity, Membership, Prisma } from '@prisma/client';
import { displayNameSchema } from '@mymozhem/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { JoinRateLimiter } from './join-rate-limiter';
import {
  JoinRateLimitedError,
  RoomJoinDeniedError,
  RoomParticipantLimitReachedError,
} from './membership.errors';

export interface JoinResult {
  membership: Membership;
  identity: Identity;
}

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly joinRateLimiter: JoinRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // Called by RoomService.create inside its transaction: the organizer becomes the
  // room's first member (design §1). A violation of the partial unique index
  // "Membership_single_organizer_key" rolls the room insert back too.
  async createOrganizerMembership(
    tx: Prisma.TransactionClient,
    roomId: string,
    identityId: string,
  ): Promise<Membership> {
    return tx.membership.create({
      data: { roomId, identityId, role: 'ORGANIZER' },
    });
  }

  // Guest join by room code + name (REQ-ID-003). Порядок проверок значим (design §3):
  // лимит по IP — ДО lookup комнаты, иначе перебор кодов не накапливает счётчик;
  // ветки «нет комнаты / удалена / терминальный статус / закрытая политика» свёрнуты
  // в один ROOM_JOIN_DENIED (REQ-ID-013).
  async join(params: { code: string; displayName: string; ip: string }): Promise<JoinResult> {
    if (!this.joinRateLimiter.tryAcquire(params.ip)) {
      throw new JoinRateLimitedError('Join rate limit exceeded');
    }
    // ZodError propagates untyped by design (§6) — mapping is the first transport's job.
    const name = displayNameSchema.parse(params.displayName);

    const room = await this.prisma.room.findUnique({ where: { code: params.code } });
    if (!room) {
      throw new RoomJoinDeniedError('no room for code');
    }
    if (room.deletedAt !== null) {
      throw new RoomJoinDeniedError(`room ${room.id} deleted`);
    }
    if (room.status === 'COMPLETED' || room.status === 'CANCELLED') {
      throw new RoomJoinDeniedError(`room ${room.id} status ${room.status}`);
    }
    if (room.joinPolicy !== 'GUESTS') {
      throw new RoomJoinDeniedError(`room ${room.id} policy ${room.joinPolicy}`);
    }

    // Гонка count-then-insert принята (design §1, развилка (б)): лимит анти-накруточный,
    // возможный перелёт на единицы; advisory lock здесь ничего ценного не защищает.
    const participantCount = await this.prisma.membership.count({
      where: { roomId: room.id, role: 'PARTICIPANT' },
    });
    if (participantCount >= this.config.ROOM_PARTICIPANT_LIMIT) {
      throw new RoomParticipantLimitReachedError(`room ${room.id} is full`);
    }

    return this.prisma.$transaction(async (tx) => {
      const identity = await this.identity.createGuest(name, tx);
      const membership = await tx.membership.create({
        data: { roomId: room.id, identityId: identity.id, role: 'PARTICIPANT' },
      });
      return { membership, identity };
    });
  }
}
```

Обновить call-site одноаргументного `new MembershipService(db.prisma)` в
`packages/core/src/room/room.service.int-spec.ts` (makeService из Task 4) — конструктор
теперь четырёхаргументный:

```ts
const makeService = (db: TestDb) =>
  new RoomService(
    db.prisma,
    new EventLogService(),
    new AppRegistryService([validManifests[0]]),
    new MembershipService(
      db.prisma,
      new IdentityService(db.prisma),
      new JoinRateLimiter(1000),
      TEST_CONFIG,
    ),
    TEST_CONFIG,
  );
```

(плюс импорты `IdentityService`, `JoinRateLimiter` в этот файл; `JoinRateLimiter(1000)` —
лимитер RoomService не использует, значение произвольное). Другие call-site'ы найти:
`grep -rn "new MembershipService(" packages apps`.

`packages/core/src/membership/membership.module.ts` — полная замена:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '../config/config.module';
import { IdentityModule } from '../identity/identity.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { MembershipService } from './membership.service';
import { JoinRateLimiter } from './join-rate-limiter';

@Module({
  imports: [PrismaModule, ConfigModule, IdentityModule],
  providers: [
    {
      provide: JoinRateLimiter,
      useFactory: (config: AppConfig) => new JoinRateLimiter(config.JOIN_RATE_LIMIT_IP),
      inject: [APP_CONFIG],
    },
    MembershipService,
  ],
  exports: [MembershipService],
})
export class MembershipModule {}
```

- [ ] **Step 6: Прогнать — GREEN**

Run:

```bash
pnpm --filter @mymozhem/core test:int -t "MembershipService.join"
pnpm --filter @mymozhem/core test:int
pnpm --filter @mymozhem/core test
```

Expected: зелёные, включая полную лану.

- [ ] **Step 7: Гейты + commit**

Run: `pnpm --filter @mymozhem/core lint && pnpm --filter @mymozhem/core typecheck`
Expected: зелёные.

```bash
git add packages/core/src
git commit -m "feat(core): guest join flow with entry limits (REQ-ID-002, REQ-ID-003, REQ-ID-006, REQ-ID-013)"
```

---

### Task 6: Экспорты, wiring приложения, полные гейты + живой boot

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `apps/server/src/app.module.ts`

**Interfaces:**
- Consumes: всё выше.
- Produces: публичный entrypoint `@mymozhem/core` с новыми модулями; приложение, в котором Nest поднимает MembershipModule/IdentityModule/ConfigModule; зелёный CI-эквивалент; доказанный boot с 6 миграциями.

- [ ] **Step 1: Экспорты core**

В `packages/core/src/index.ts` добавить после строки `export * from './config/config.schema';`:

```ts
export * from './config/config.tokens';
export * from './config/config.module';
```

и после room-блока:

```ts
export * from './identity/identity.service';
export * from './identity/identity.module';
export * from './membership/membership.errors';
export * from './membership/join-rate-limiter';
export * from './membership/membership.service';
export * from './membership/membership.module';
```

- [ ] **Step 2: AppModule сервера**

`apps/server/src/app.module.ts` — полная замена:

```ts
import { Module } from '@nestjs/common';
import {
  AppRegistryModule,
  HealthModule,
  IdentityModule,
  MembershipModule,
  PrismaModule,
  RealtimeModule,
  RoomModule,
} from '@mymozhem/core';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AppRegistryModule,
    RoomModule,
    IdentityModule,
    MembershipModule,
    RealtimeModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Полная лана гейтов из корня**

Run:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm boundary-check && pnpm guardrails && pnpm build
```

Expected: всё зелёное. `boundary-check` — 0 нарушений (зависимости room → membership → identity внутри core правилам не запрещены, конфиг depcruise не менялся — controller note).

- [ ] **Step 4: Живой boot docker-артефакта со свежей БД**

Run:

```bash
docker compose up --build -d
until curl -sf http://localhost:3000/health/ready >/dev/null; do sleep 2; done
docker compose exec -T postgres psql -U mymozhem -c "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at NULLS LAST;"
docker compose down -v
```

Expected: `/health/ready` → 200; в `_prisma_migrations` 6 строк, последняя `<timestamp>_membership_guest_join`; `down -v` убирает контейнеры и volume (хост-порт 5432/`lt-pg` не тронут — compose не публикует postgres наружу). Fallback, если psql-запрос не находит таблицу в `public` (multiSchema): `docker compose logs server 2>&1 | grep -i "membership_guest_join"`.

- [ ] **Step 5: Финальный коммит**

```bash
git add packages/core/src/index.ts apps/server/src/app.module.ts
git commit -m "feat(core): wire identity/membership modules into the app (REQ-ID-002)"
```

(Если Steps 3–4 потребовали правок — они коммитятся отдельно `fix(core): …` с REQ-тегом до этого коммита.)
