# ADR-012 (zero-PII MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать ADR-012: удалить OAuth-контур, ввести bootstrap организатора по setup-токену, серверные псевдонимы гостей, `prize_mode`-гейт с безпризовой лотереей, расширение свипа на joinIp/Exclusion, амендмент v1.5.

**Architecture:** Девять задач в трёх батчах (A: спека/контракт/конфиг → B: ядро → C: механики/клиент/ops). Каждый батч — отдельная сессия (правило батчей). Работа в worktree `.worktrees/adr-012-zero-pii`, ветка `adr-012-zero-pii`.

**Tech Stack:** NestJS + Fastify, Prisma (multiSchema), zod-контракт SDK, Socket.io, React/Vite, pnpm+turbo.

**Spec:** `docs/sessions/2026-10-12-adr-012-zero-pii-design.md` (§0 — решения владельца) + `docs/adr/adr-012-zero-pii-mvp.md`.

## Global Constraints

- Работа только в worktree `.worktrees/adr-012-zero-pii`; коммиты в ветку `adr-012-zero-pii`. Коммиты завершаются строкой `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Замороженные миграции не трогаем; изменения схемы БД — только новой миграцией. Частичные индексы — SQL-миграцией + автотест наличия, БЕЗ preview `partialIndexes` (REQ-DEV-006).
- Никакого `catch` unique-violation ВНУТРИ транзакции (Postgres aborted-tx ловушка); типизированный no-op — через `ON CONFLICT ... DO NOTHING` или catch ВНЕ `$transaction`.
- actorId — только из аутентифицированного контекста (REQ-RT-009 по духу HTTP); наружу из ошибок — ровно `{code}` (REQ-SEC-006).
- `Math.random` запрещён в `packages/app-*` (lint); случайность в core-генераторе псевдонимов — `crypto.randomInt` (дух REQ-RWD-011).
- Один lockfile; CI-порядок build → boundary-check. Гейты, которые обязаны быть зелёными в конце каждой задачи: `pnpm build && pnpm boundary-check && pnpm guardrails && pnpm lint && pnpm typecheck && pnpm test`; int/e2e — по командам задачи.
- jest testPathPattern матчит ПУТЬ, включая имя worktree — для точечного прогона использовать уникальное имя файла (`-- organizer-bootstrap.e2e`), не слова вроде `auth`.
- Root `pnpm typecheck` НЕ покрывает int/e2e-спеки — дрейф сигнатур ловить прогоном `pnpm --filter @mymozhem/core test:int` и `pnpm --filter @mymozhem/server test`.
- Имена событий app-модулей — dotted-lowercase; wire-роли lowercase.

## Review Focus

Пять классов входов/состояний, которые спека подразумевает, но которые легко пропустить:

1. **Параллельные `POST /auth/organizer`** (двойной клик / два запроса в одну миллисекунду на пустом инстансе) — обязана быть ровно одна REGISTERED-identity. Пин: race-тест в T5 (шаг 4) поверх индекса из T4.
2. **Прямой HTTP join без `displayName`** (мимо web-клиента) — сервер обязан назначить псевдоним сам, 400 быть не должно. Пин: int-тест в T6 (шаг 4).
3. **`draw.run` с prizeId при `prize_mode=off`** — весь dispatch откатывается: ни echo-коммитов, ни award, ни списания фонда; ack несёт `PRIZES_DISABLED`. Пин: int-тест в T7 (шаг 5).
4. **Свип identity с живой Exclusion и joinIp** — после свипа IP нигде не читается (rejoin-блок снят осознанно, ADR §3). Пин: инвариант-тест в T8 (шаг 2).
5. **Неверный setup-токен другой длины** — сравнение не должно утекать длиной/временем (digest-compare) и не должно давать оракула через rate-limit (лимитер до проверки). Пины: unit в T5 (шаг 2) и порядок гейтов в контроллере T5 (шаг 3).

---

## Батч A — спека/контракт/конфиг (сессия 1)

### Task 1: Амендмент v1.5 к нормативному пакету

**REQ:** REQ-DEV-004 (оформление изменения норм), REQ-ID-003 (уточнение), REQ-ID-004/009/015/017 + REQ-RWD-014 verified-ветка (приостановка), REQ-ID-012 (маркер), REQ-ID-014 (маркер расширения свипа).

**Files:**
- Create: `docs/spec/amendment-v1.5-zero-pii.md`

**Interfaces:**
- Produces: нормативную рамку среза; задачи T2–T9 ссылаются на неё в комментариях/коммитах.

- [ ] **Step 1: Написать амендмент** по образцу `docs/spec/amendment-v1.4-admin-contour.md` (структура: статус/основание → таблица пере-разметки → следствия → что не меняется). Содержание:

```markdown
# Амендмент v1.5 — zero-PII MVP (ADR-012)

**Статус:** утверждён владельцем 2026-10-12. Приостанавливает четыре нормы и одну ветку нормы, уточняет REQ-ID-003, добавляет два параметра §4. Тексты норм в пакете v1.2 не переписываются — действует эта пометка.
**Основание:** ADR-012 (`docs/adr/adr-012-zero-pii-mvp.md`, принят 2026-10-12) — юридическая минимизация MVP: self-hosted норма, REGISTERED без OAuth (bootstrap по organizer_setup_token), псевдонимы, prize_mode по умолчанию off.

## 1. Приостановки и уточнения

| Норма | Эффект | Основание |
|---|---|---|
| REQ-ID-003 | **Уточняется:** имя гостя необязательно; при отсутствии сервер назначает псевдоним (словарь + discriminator). TTL-норма не меняется | ADR-012 §3 |
| REQ-ID-004, REQ-ID-017 | **Приостановлены** — аккаунтов нет; активация возвратом аккаунтного контура | ADR-012 §2 |
| REQ-ID-009, REQ-ID-015 | **Приостановлены** вместе с OAuth-контуром (удалён физически; git хранит); OAuth-часть REQ-SEC-007 — с ними | ADR-012 §2 |
| REQ-RWD-014, verified-ветка | **Приостановлена и удалена из кода**: draw_eligibility снят из манифеста лотереи (v2); guests_allowed — единственное действующее значение до возврата аккаунтов | ADR-012 §4, решение §0.6 дизайна |
| REQ-ID-012 | Маркер: при фазовом проектировании ф.4 формулируется заново — allowlist identity-id уступает место self-hosted норме (админ = владелец инстанса) | ADR-012, таблица следствий |
| REQ-ID-014 | Текст не меняется; реализация свипа расширена: обнуление Membership.joinIp и удаление Exclusion свипнутых identity | ADR-012 §3 |

## 2. Параметры §4 (дополнение)

| Параметр | Значение по умолчанию | Диапазон/форма | Комментарий |
|---|---|---|---|
| `organizer_setup_token` | нет (обязателен) | ≥ 32 байта | Bootstrap единственного организатора инстанса (POST /auth/organizer); проверка при старте по образцу REQ-SEC-002 |
| `prize_mode` | `off` | `off` \| `on` | При `off`: создание призов и розыгрыш с призом отклоняются PRIZES_DISABLED; fulfill/revoke/list существующих awards работают; `award.points` разрешён в обоих режимах |

## 3. Принятый эффект редеплоя

Манифест лотереи — v2 (сужение draw_eligibility + необязательный prizeId). ACTIVE-комнаты, запиненные на lottery@1, после выката недостижимы сервисным путём (boot-time реестр, REQ-CORE-007); для self-hosted MVP с одним живым событием принято владельцем.

## 4. Что не меняется

REQ-ID-001/005/016 (модель identity, организатор=REGISTERED, единые токены), REQ-ID-006 (анти-накрутка и rejoin-блок в живом контуре), REQ-SEC-004 (объект сокращён до временного joinIp — норма поглощающая), REQ-SEC-009 (сторожевой инвариант ПДн вне payload'ов), ADR-001…011, тексты приостановленных норм (они не отменены — приостановлены до триггеров ADR-012).
```

- [ ] **Step 2: Сверка с ADR:** каждая строка таблицы «Следствия → Требования» из `docs/adr/adr-012-zero-pii-mvp.md` отражена в амендменте. Прогнать `grep -n 'REQ-ID-004\|REQ-ID-009\|REQ-ID-015\|REQ-ID-017\|REQ-RWD-014' docs/spec/amendment-v1.5-zero-pii.md` — все пять норм присутствуют.
- [ ] **Step 3: Commit**

```bash
git add docs/spec/amendment-v1.5-zero-pii.md
git commit -m "docs(spec): амендмент v1.5 — zero-PII MVP (ADR-012): приостановки REQ-ID-004/009/015/017, verified-ветки REQ-RWD-014; параметры organizer_setup_token/prize_mode"
```

---

### Task 2: SDK 2.0.0 — контракт среза

**REQ:** REQ-CTR-004 (версия = контракт), REQ-CTR-005 (контрактные тесты из схем), REQ-DEV-007 (аддитивная эволюция: displayName optional, join-ответ += displayName), REQ-ID-003 (имя необязательно).

**Files:**
- Delete: `packages/sdk/src/auth/oauth-start-query.ts`, `packages/sdk/src/auth/oauth-callback-query.ts`, `packages/sdk/src/auth/oauth-query.contract.spec.ts`
- Modify: `packages/sdk/src/errors/error-codes.ts:29-36` (удалить 7 `OAUTH_*`, добавить `PRIZES_DISABLED`, `ORGANIZER_SETUP_INVALID`)
- Modify: `packages/sdk/src/errors/error-codes.contract.spec.ts:31-37`
- Modify: `packages/sdk/src/auth/join-request.ts` (displayName → optional)
- Modify: `packages/sdk/src/auth/join-request.fixtures.ts`, `join-request.contract.spec.ts`
- Create: `packages/sdk/src/auth/organizer-bootstrap-request.ts` + `organizer-bootstrap-request.contract.spec.ts`
- Create: `packages/sdk/src/auth/join-response.ts` + `join-response.contract.spec.ts`
- Modify: `packages/sdk/src/index.ts` (баррель)
- Modify: `packages/sdk/src/contract-version.ts:8` → `'2.0.0'`; `packages/sdk/package.json` → `"version": "2.0.0"`

**Interfaces:**
- Produces (потребители — T5, T6, T7, T9):
  - `organizerBootstrapRequestSchema` = `z.strictObject({ setupToken: z.string().min(1) })`, тип `OrganizerBootstrapRequest`.
  - `joinResponseSchema` = `tokenResponseSchema.extend({ displayName: z.string() })`, тип `JoinResponse` (extend сохраняет strictObject).
  - `joinRequestSchema.displayName` — `displayNameSchema.optional()`; тип `JoinRequest['displayName']` → `string | undefined`.
  - `CONTRACT_ERROR_CODES` += `'PRIZES_DISABLED'`, `'ORGANIZER_SETUP_INVALID'`; минус все `OAUTH_*`.

- [ ] **Step 1: Падающие контрактные тесты.** Обновить фикстуры/спеки:

`join-request.fixtures.ts` — перенести `{ code: 'ABCDEFGH' }` из `invalidJoinRequests` в `validJoinRequests` (join без имени — валиден, ADR-012 §3).

`organizer-bootstrap-request.contract.spec.ts`:

```ts
import { organizerBootstrapRequestSchema } from './organizer-bootstrap-request';

describe('organizerBootstrapRequest contract (ADR-012)', () => {
  it('accepts a non-empty setupToken', () => {
    expect(organizerBootstrapRequestSchema.safeParse({ setupToken: 'x'.repeat(32) }).success).toBe(true);
  });
  it.each([[{}], [{ setupToken: '' }], [{ setupToken: 'x', extra: 1 }], ['nope']])(
    'rejects %j',
    (v) => expect(organizerBootstrapRequestSchema.safeParse(v).success).toBe(false),
  );
});
```

`join-response.contract.spec.ts`:

```ts
import { joinResponseSchema } from './join-response';

describe('joinResponse contract (ADR-012: серверный псевдоним в ответе)', () => {
  it('accepts token pair + displayName', () => {
    expect(
      joinResponseSchema.safeParse({ accessToken: 'a', tokenType: 'Bearer', expiresIn: 900, displayName: 'Лиса-42' }).success,
    ).toBe(true);
  });
  it('rejects missing displayName (сервер обязан назначить)', () => {
    expect(joinResponseSchema.safeParse({ accessToken: 'a', tokenType: 'Bearer', expiresIn: 900 }).success).toBe(false);
  });
});
```

`error-codes.contract.spec.ts` — ожидание списка кодов: убрать 7 `OAUTH_*`, добавить `PRIZES_DISABLED` и `ORGANIZER_SETUP_INVALID`.

- [ ] **Step 2: Прогон — красные**

```bash
pnpm --filter @mymozhem/sdk test
# Expected: FAIL — organizerBootstrapRequestSchema/joinResponseSchema не существуют, фикстура без displayName падает, список кодов расходится
```

- [ ] **Step 3: Реализация**

`packages/sdk/src/auth/join-request.ts`:

```ts
export const joinRequestSchema = z.strictObject({
  code: z.string().trim().min(1),
  // ADR-012 §3: имя необязательно — при отсутствии сервер назначает псевдоним.
  displayName: displayNameSchema.optional(),
  role: z.enum(['participant', 'spectator']).optional(),
});
```

`packages/sdk/src/auth/organizer-bootstrap-request.ts`:

```ts
import { z } from 'zod';

// POST /auth/organizer (ADR-012 §2): bootstrap единственного REGISTERED инстанса
// по setup-токену из конфигурации. Длина проверяется сервером сравнением с
// конфигом (timing-safe), здесь — только форма.
export const organizerBootstrapRequestSchema = z.strictObject({
  setupToken: z.string().min(1),
});
export type OrganizerBootstrapRequest = z.infer<typeof organizerBootstrapRequestSchema>;
```

`packages/sdk/src/auth/join-response.ts`:

```ts
import { z } from 'zod';
import { tokenResponseSchema } from './token-response';

// Ответ POST /rooms/join (ADR-012 §3): фактический displayName (заданный или
// назначенный сервером псевдоним) — клиент сохраняет его для авто-rejoin.
export const joinResponseSchema = tokenResponseSchema.extend({
  displayName: z.string().min(1),
});
export type JoinResponse = z.infer<typeof joinResponseSchema>;
```

`error-codes.ts`: удалить строки 29–36 (комментарий + 7 `OAUTH_*`), добавить после `ROOM_ORGANIZER_NOT_REGISTERED`-блока:

```ts
  // ADR-012 (срез zero-PII): bootstrap организатора и призовой режим.
  'ORGANIZER_SETUP_INVALID',
  'PRIZES_DISABLED',
```

`index.ts`: удалить строки 32–33 (`oauth-start-query`, `oauth-callback-query`); добавить `export * from './auth/organizer-bootstrap-request';` и `export * from './auth/join-response';` (рядом с join-request/token-response).

`contract-version.ts:8` → `export const CONTRACT_VERSION = '2.0.0';` и `package.json` → `"version": "2.0.0"` (парность запинана contract-version.contract.spec).

- [ ] **Step 4: Прогон — зелёные + сборка**

```bash
pnpm --filter @mymozhem/sdk test && pnpm --filter @mymozhem/sdk build
# Expected: PASS; build чистый (баррель без мёртвых ссылок)
```

- [ ] **Step 5: Каскадная проверка компиляции потребителей.** SDK 2.0 ломает импортёров oauth-схем (web landing импортирует только типы — проверить): `pnpm typecheck` — ожидаемые красные места: `apps/web` (если импортирует oauth-схемы — нет, проверить `grep -rn 'oauth' apps/web/src`) и core (oauth.controller использует oauth-схемы из SDK? — проверить `grep -rn 'oauthStartQuery\|oauthCallbackQuery\|OAUTH_' packages/core/src packages/app-*`). Известные потребители удаляются в T4 — зафиксировать красное дерево как ожидаемое промежуточное состояние батча A, НЕ чинить (T4 зеленеет). Если красное есть вне известного инвентаря T4 — остановиться, эскалация.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk)!: контракт 2.0.0 — ADR-012: displayName необязателен, join-ответ с displayName, bootstrap-схема, коды PRIZES_DISABLED/ORGANIZER_SETUP_INVALID; удалены oauth-схемы и OAUTH_* коды"
```

---

### Task 3: Конфиг — новые параметры, снятие OAuth-секции

**REQ:** REQ-SEC-002 (обязательный секрет ≥32), REQ-OPS-003 (валидация конфига при старте), REQ-SEC-007 (rate-limit bootstrap-эндпоинта).

**Files:**
- Modify: `packages/core/src/config/config.schema.ts` (удалить строки 57–75 и Google-блок superRefine 87–102; добавить три ключа)
- Modify: `packages/core/src/config/config.schema.spec.ts` (заменить oauth-кейсы строк 79–110 новыми)
- Modify: `packages/core/src/testing/test-config.ts` (TEST_CONFIG)

**Interfaces:**
- Produces (потребители — T4, T5, T7): `AppConfig.ORGANIZER_SETUP_TOKEN: string`, `AppConfig.ORGANIZER_RATE_LIMIT: number`, `AppConfig.PRIZE_MODE: 'off' | 'on'`. Из `AppConfig` исчезают `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `OAUTH_REDIRECT_ALLOWLIST`, `OAUTH_STATE_TTL`, `OAUTH_RATE_LIMIT`.

- [ ] **Step 1: Падающие тесты** — в `config.schema.spec.ts` удалить кейсы Google-секции (allowlist-required, allowlist parsing, all-or-none) и добавить:

```ts
describe('ADR-012 параметры', () => {
  const base = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 's'.repeat(32), ORGANIZER_SETUP_TOKEN: 't'.repeat(32) };
  it('requires ORGANIZER_SETUP_TOKEN (fail-fast, образец JWT_SECRET/REQ-SEC-002)', () => {
    const { ORGANIZER_SETUP_TOKEN: _drop, ...env } = base;
    expect(() => loadConfig(env)).toThrow(/ORGANIZER_SETUP_TOKEN/);
  });
  it('rejects ORGANIZER_SETUP_TOKEN shorter than 32 bytes', () => {
    expect(() => loadConfig({ ...base, ORGANIZER_SETUP_TOKEN: 'short' })).toThrow(/ORGANIZER_SETUP_TOKEN/);
  });
  it('defaults PRIZE_MODE to off and ORGANIZER_RATE_LIMIT to 10', () => {
    const cfg = loadConfig(base);
    expect(cfg.PRIZE_MODE).toBe('off');
    expect(cfg.ORGANIZER_RATE_LIMIT).toBe(10);
  });
  it('accepts PRIZE_MODE=on', () => {
    expect(loadConfig({ ...base, PRIZE_MODE: 'on' }).PRIZE_MODE).toBe('on');
  });
});
```

(Сверить с существующими хелперами спеки — если есть общий `validEnv`, использовать его, добавив `ORGANIZER_SETUP_TOKEN`.)

- [ ] **Step 2: Прогон — красные**

```bash
pnpm --filter @mymozhem/core test -- config.schema
# Expected: FAIL — ORGANIZER_SETUP_TOKEN неизвестен схеме
```

- [ ] **Step 3: Реализация** — в `config.schema.ts`:

Удалить ключи `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `OAUTH_REDIRECT_ALLOWLIST`, `OAUTH_STATE_TTL`, `OAUTH_RATE_LIMIT` (строки 57–75) и оба Google-if в `superRefine` (строки 87–102; CORS-ветка superRefine остаётся).

Добавить после `JWT_SECRET`:

```ts
  // ADR-012 §2: bootstrap единственного организатора инстанса. Обязателен,
  // ≥ 32 байта; дефолта нет — старт без токена невозможен (образец REQ-SEC-002).
  ORGANIZER_SETUP_TOKEN: z.string().min(32),
  // REQ-SEC-007 (§4 login_rate_limit): POST /auth/organizer, 10/мин на IP.
  ORGANIZER_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  // ADR-012 §4: призовой режим. off — создание призов и розыгрыш с призом
  // отклоняются PRIZES_DISABLED; on — юридическая ответственность организатора.
  PRIZE_MODE: z.enum(['off', 'on']).default('off'),
```

В `test-config.ts`: удалить `OAUTH_STATE_TTL`, `OAUTH_RATE_LIMIT`, `OAUTH_REDIRECT_ALLOWLIST`; добавить `ORGANIZER_SETUP_TOKEN: 'test-only-organizer-setup-token!!'` (≥32 символа), `ORGANIZER_RATE_LIMIT: 10`, `PRIZE_MODE: 'off'`.

- [ ] **Step 4: Прогон — зелёные**

```bash
pnpm --filter @mymozhem/core test -- config.schema
# Expected: PASS
```

- [ ] **Step 5: Каскад.** Красные места от удалённых ключей: `transport.module.ts` (фабрики OAUTH-лимитеров), `oauth.service.ts`, `oauth.e2e-spec.ts`, `main.ts`? — все в инвентаре T4. Проверить `grep -rn 'OAUTH_\|GOOGLE_' packages/core/src apps/server/src apps/server/test` — каждое попадание обязано быть в инвентаре T4; иное — стоп, эскалация. Дерево красное до T4 — ожидаемо.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config packages/core/src/testing/test-config.ts
git commit -m "feat(core): конфиг ADR-012 — ORGANIZER_SETUP_TOKEN (обязателен, ≥32), ORGANIZER_RATE_LIMIT, PRIZE_MODE (default off); снята OAuth-секция (OAUTH_*/GOOGLE_*)"
```

---

## Батч B — ядро (сессия 2)

### Task 4: Удаление OAuth-контура + миграция drop_identity_provider

**REQ:** REQ-ID-015/009 (приостановлены — контур удаляется физически), REQ-DEV-006 (индекс SQL-миграцией + автотест), REQ-SEC-006 (фильтр без OAUTH-веток), REQ-ID-001 (единственность REGISTERED).

**Интерпретация плана I-1:** миграция переехала из T3 сюда: `schema.prisma` → клиент Prisma → `identity.service.findOrCreateByProvider` → `oauth.service` — одна цепочка компиляции; разрывать её между задачами = красные коммиты.

**Files:**
- Delete: `packages/core/src/oauth/` (8 файлов целиком), `packages/core/src/transport/oauth.controller.ts`, `apps/server/test/oauth.e2e-spec.ts`, `packages/core/src/identity/identity-provisioning.int-spec.ts`, `packages/core/src/identity/identity-provider-schema.int-spec.ts`
- Create: `packages/core/prisma/migrations/<timestamp>_drop_identity_provider/migration.sql`
- Create: `packages/core/src/identity/organizer-schema.int-spec.ts` (замена удалённой schema-спеки)
- Modify: `packages/core/prisma/schema.prisma` (удалить `model IdentityProvider` L113–126 и поле `Identity.providers` L84)
- Modify: `packages/core/src/identity/identity.service.ts` (удалить `findOrCreateByProvider` L33–89, обновить комментарий инварианта L30–32)
- Modify: `packages/core/src/transport/transport.module.ts` (убрать OAuthModule/OAuthController/2 фабрики), `packages/core/src/transport/auth.tokens.ts` (убрать 2 символа)
- Modify: `packages/core/src/transport/http-exception.filter.ts` + спек (убрать OAuthError-ветки и 7 строк мапы)
- Modify: `packages/core/src/index.ts` (убрать oauth-экспорты)
- Modify: `packages/core/src/observability/pino-options.spec.ts` (фикстуры: google-URL → нейтральный URL с query-секретом, `mm_oauth_state` → нейтральное имя куки; поведение тестов не меняется), комментарии `pino-logger.module.ts`, `http.types.ts`

**Interfaces:**
- Consumes: T3 (из AppConfig уже удалены OAUTH_* — эта задача снимает их потребителей).
- Produces: `identity."Identity"` с индексом `Identity_single_registered_key` (потребитель — T5); чистое дерево без oauth (критерий выхода 1).

- [ ] **Step 1: Миграция.** Создать `packages/core/prisma/migrations/<timestamp>_drop_identity_provider/migration.sql`:

```sql
-- ADR-012 §2: OAuth-контур удалён, provider-данные больше не существуют.
DROP TABLE identity."IdentityProvider";

-- ADR-012 §2: ровно один живой REGISTERED на инстанс. Прежний частичный индекс
-- "Identity_registered_email_key" построен по lower(email) и при email = NULL
-- единственность НЕ гарантирует (NULL не конфликтует) — bootstrap полагается
-- на этот индекс (гонка двух bootstrap'ов → P2002 → re-read победителя).
CREATE UNIQUE INDEX "Identity_single_registered_key"
  ON identity."Identity"(kind)
  WHERE kind = 'REGISTERED' AND "deletedAt" IS NULL;
```

- [ ] **Step 2: Падающая schema-спека** — `organizer-schema.int-spec.ts` по образцу удаляемой `identity-provider-schema.int-spec.ts` (тот же запрос к `pg_indexes`/`information_schema`, сменить объект ассерта):

```ts
// ADR-012: таблица IdentityProvider удалена; единственность организатора —
// частичный индекс Identity_single_registered_key (REQ-DEV-006: автотест наличия).
it('drops identity."IdentityProvider"', async () => {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = 'identity' AND table_name = 'IdentityProvider'`;
  expect(rows).toEqual([]);
});
it('has Identity_single_registered_key partial unique index', async () => {
  const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'identity' AND tablename = 'Identity' AND indexname = 'Identity_single_registered_key'`;
  expect(rows).toHaveLength(1);
  expect(rows[0].indexdef).toContain('UNIQUE');
  expect(rows[0].indexdef).toContain('REGISTERED');
  expect(rows[0].indexdef).toContain('deletedAt');
});
```

- [ ] **Step 3: Удаление кода.** Применить миграцию к тестовой БД и перегенерировать клиент (`pnpm --filter @mymozhem/core prisma:generate`), затем удалить файлы и правки из шапки. `identity.service.ts`: удалить `findOrCreateByProvider` целиком; комментарий инварианта теперь:

```ts
// Инвариант «change both or neither» (двух мест): предикат
// kind='REGISTERED' AND deletedAt IS NULL — partial index "Identity_single_registered_key"
// и guarded create в findOrCreateOrganizer (T5). Менять только вместе.
```

`identity.errors.ts`: коды `EMAIL_CONFLICT`/`PROVIDER_IDENTITY_GONE` потеряли производителя — удалить весь файл и его экспорт из барреля (проверить `grep -rn 'IdentityError\|IDENTITY_ERROR_CODES' packages apps --include='*.ts' | grep -v node_modules` — потребителей вне oauth быть не должно).

`http-exception.filter.ts`: убрать импорт `OAuthError`, 7 строк `OAUTH_*` из `STATUS_BY_WIRE_CODE`, ветку `instanceof OAuthError` (L83 — оставить только AuthError с правкой комментария), ветку `toWireCode` (L100). Спек фильтра: удалить строки маппинга и тест «logs 4xx OAuthError at warn».

- [ ] **Step 4: Прогон гейтов ядра**

```bash
pnpm --filter @mymozhem/core build && pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/core test:int
# Expected: PASS (включая новую organizer-schema.int-spec)
```

- [ ] **Step 5: Серверные e2e и гейты монорепы**

```bash
pnpm --filter @mymozhem/server test && pnpm build && pnpm boundary-check && pnpm guardrails && pnpm lint && pnpm typecheck
# Expected: PASS; grep -rn 'oauth\|OAUTH\|GOOGLE_' packages/core/src packages/sdk/src apps/server/src apps/server/test --include='*.ts' — пусто (кроме упоминаний в комментариях-истории, которые задача почистила)
```

Примечание: apps/web и apps/server e2e smoke ещё ссылаются на OAuth-флоу (лендинг, smoke.spec Шаг 0) — это T9; если `pnpm test` монорепы их затрагивает (vitest apps/web), красное web-ожидание зафиксировать и чинить только если падает не-web контур. `apps/web/e2e` вне typecheck (deferred T16 UI-среза) — smoke.spec компиляцией не гейтится.

- [ ] **Step 6: Commit**

```bash
git add -A packages apps/server
git commit -m "feat(core)!: удаление OAuth-контура (ADR-012) — модуль/контроллер/лимитеры/фильтр/e2e; миграция drop IdentityProvider + индекс единственности организатора"
```

---

### Task 5: POST /auth/organizer — bootstrap организатора

**REQ:** REQ-ID-005 (организатор = REGISTERED), REQ-ID-016 (единые токены), REQ-ID-008 (refresh — httpOnly-кука), REQ-SEC-002 (setup-токен ≥32), REQ-SEC-007 (rate-limit до проверки), REQ-SEC-006 (наружу только код).

**Files:**
- Create: `packages/core/src/auth/setup-token.ts` + `packages/core/src/auth/setup-token.spec.ts`
- Modify: `packages/core/src/identity/identity.service.ts` (+= `findOrCreateOrganizer`)
- Create: `packages/core/src/identity/organizer-bootstrap.int-spec.ts`
- Modify: `packages/core/src/transport/auth.controller.ts` (+= endpoint), `packages/core/src/transport/auth.tokens.ts` (+= символ), `packages/core/src/transport/transport.module.ts` (+= фабрика)
- Modify: `packages/core/src/transport/http-exception.filter.ts` (+= `ORGANIZER_SETUP_INVALID: 401`) + спек
- Create: `apps/server/test/organizer-bootstrap.e2e-spec.ts`

**Interfaces:**
- Consumes: T2 (`organizerBootstrapRequestSchema`, код `ORGANIZER_SETUP_INVALID`, `TokenResponse`), T3 (`ORGANIZER_SETUP_TOKEN`, `ORGANIZER_RATE_LIMIT`), T4 (индекс).
- Produces: endpoint `POST /auth/organizer` (потребитель — T9 web/seed/smoke); `IdentityService.findOrCreateOrganizer(): Promise<Identity>`; `setupTokenMatches(provided: string, expected: string): boolean`; символ `ORGANIZER_BOOTSTRAP_RATE_LIMITER`.

- [ ] **Step 1: Падающий unit на сравнение токена** — `setup-token.spec.ts`:

```ts
import { setupTokenMatches } from './setup-token';

describe('setupTokenMatches (ADR-012, REQ-SEC-002)', () => {
  const expected = 'correct-token-32-bytes-long-string!';
  it('matches identical strings', () => expect(setupTokenMatches(expected, expected)).toBe(true));
  it('rejects a wrong token of the same length', () =>
    expect(setupTokenMatches('x'.repeat(expected.length), expected)).toBe(false));
  it('rejects without leaking length (shorter/longer candidates)', () => {
    expect(setupTokenMatches('short', expected)).toBe(false);
    expect(setupTokenMatches(expected + 'x', expected)).toBe(false);
    expect(setupTokenMatches('', expected)).toBe(false);
  });
});
```

- [ ] **Step 2: Реализация сравнения** — `setup-token.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto';

// Сравнение через sha256-дайджесты: timingSafeEqual требует равной длины буферов,
// а дайджесты выравнивают длину — кандидат любой длины не утекает ни длиной,
// ни временем (Review Focus 5).
export function setupTokenMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 3: Падающий int на identity + endpoint-контур.** `organizer-bootstrap.int-spec.ts` (по образцу существующих identity int-спек — testcontainer, `TEST_CONFIG`):

```ts
it('creates exactly one REGISTERED under concurrent bootstrap (Review Focus 1)', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => identity.findOrCreateOrganizer()));
  const ids = new Set(results.map((i) => i.id));
  expect(ids.size).toBe(1);
  const count = await prisma.identity.count({ where: { kind: 'REGISTERED', deletedAt: null } });
  expect(count).toBe(1);
});
it('is idempotent: repeat calls return the same identity with email=NULL', async () => {
  const first = await identity.findOrCreateOrganizer();
  const second = await identity.findOrCreateOrganizer();
  expect(second.id).toBe(first.id);
  expect(first.email).toBeNull();
  expect(first.displayName).toBe('Организатор');
});
```

- [ ] **Step 4: Реализация `findOrCreateOrganizer`** — в `identity.service.ts`:

```ts
// ADR-012 §2: единственный REGISTERED инстанса, email = NULL. Гонка первых
// bootstrap'ов: проигравший ловит P2002 от "Identity_single_registered_key" и
// перечитывает победителя. create ВНЕ $transaction — catch P2002 не отравляет
// чужую tx (ловушка aborted-tx). Инвариант — см. комментарий у шапки сервиса.
async findOrCreateOrganizer(): Promise<Identity> {
  const existing = await this.prisma.identity.findFirst({
    where: { kind: 'REGISTERED', deletedAt: null },
  });
  if (existing) return existing;
  try {
    return await this.prisma.identity.create({
      data: { kind: 'REGISTERED', displayName: 'Организатор' },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await this.prisma.identity.findFirst({
        where: { kind: 'REGISTERED', deletedAt: null },
      });
      if (winner) return winner;
    }
    throw err;
  }
}
```

- [ ] **Step 5: Endpoint.** `auth.tokens.ts` += `export const ORGANIZER_BOOTSTRAP_RATE_LIMITER = Symbol('ORGANIZER_BOOTSTRAP_RATE_LIMITER');`. `transport.module.ts` += фабрика (рядом с REFRESH):

```ts
{
  provide: ORGANIZER_BOOTSTRAP_RATE_LIMITER,
  useFactory: (config: AppConfig) => new JoinRateLimiter(config.ORGANIZER_RATE_LIMIT),
  inject: [APP_CONFIG],
},
```

`auth.controller.ts` — новый handler (конструктор += `@Inject(ORGANIZER_BOOTSTRAP_RATE_LIMITER) private readonly organizerRateLimiter: JoinRateLimiter` и `private readonly identity: IdentityService`; AuthModule экспортирует только TokenService — добавить `IdentityModule` в `imports` TransportModule уже есть? — проверить: transport.module L23 импортирует MembershipModule, AuthModule, RoomModule… IdentityModule транзитивно через MembershipModule; если DI не разрешится — добавить IdentityModule в imports TransportModule, прецедент T7-шова Quiz-среза):

```ts
// ADR-012 §2: bootstrap единственного организатора по setup-токену. Лимитер —
// ДО проверки токена (нет оракула «верный, но лимит»); отказ одинаков при любом
// mismatch (401 ORGANIZER_SETUP_INVALID), повтор — та же identity, новая пара.
@Post('organizer')
@HttpCode(200)
async organizer(
  @Body() body: unknown,
  @Req() req: RequestLike,
  @Res({ passthrough: true }) reply: ReplyLike,
): Promise<TokenResponse> {
  if (!this.organizerRateLimiter.tryAcquire(req.ip)) {
    throw new JoinRateLimitedError('organizer bootstrap rate limit exceeded'); // 429 RATE_LIMITED
  }
  const { setupToken } = organizerBootstrapRequestSchema.parse(body);
  if (!setupTokenMatches(setupToken, this.config.ORGANIZER_SETUP_TOKEN)) {
    throw new ContractError('ORGANIZER_SETUP_INVALID', 'organizer setup token mismatch');
  }
  const identity = await this.identity.findOrCreateOrganizer();
  const issued = await this.tokens.issueRegisteredTokens(identity.id);
  setRefreshCookie(reply, issued.refreshToken, this.config, issued.kind);
  return { accessToken: issued.accessToken, tokenType: 'Bearer', expiresIn: issued.expiresIn };
}
```

`http-exception.filter.ts`: `STATUS_BY_WIRE_CODE` += `ORGANIZER_SETUP_INVALID: 401` (рядом с SESSION_INVALID; ContractError wire-parity ветка уже существует — код покрывается членством в мапе). Спек фильтра: строка маппинга + кейс «ContractError ORGANIZER_SETUP_INVALID → 401».

- [ ] **Step 6: e2e** — `apps/server/test/organizer-bootstrap.e2e-spec.ts` по образцу удалённого `oauth.e2e-spec.ts` (бут реального AppModule с env-override: `ORGANIZER_SETUP_TOKEN`):

```ts
// Скелет сценариев (детали бута — по образцу oauth.e2e-spec.ts env save/restore):
it('rejects a wrong token: 401 {code: ORGANIZER_SETUP_INVALID}, без куки', ...);
it('bootstraps: 200, TokenResponse по SDK-схеме, Set-Cookie mm_refresh (Path=/auth, HttpOnly)', ...);
it('second call returns the SAME identity (claims.sub совпадает) и новую токен-пару', ...);
it('bootstrapped organizer creates a room: POST /rooms с access → 201 (полный путь без OAuth)', ...);
it('rate limit: N+1 вызовов с неверным токеном → 429 RATE_LIMITED (лимитер до проверки токена)', ...);
```

- [ ] **Step 7: Прогоны**

```bash
pnpm --filter @mymozhem/core test -- setup-token
pnpm --filter @mymozhem/core test:int -- organizer-bootstrap
pnpm --filter @mymozhem/server test -- organizer-bootstrap.e2e
pnpm --filter @mymozhem/core test && pnpm --filter @mymozhem/server test
# Expected: все PASS. Помнить: NODE_OPTIONS зашит в test-скрипт server; точечный прогон — по уникальному имени файла.
```

- [ ] **Step 8: Commit**

```bash
git add packages/core apps/server
git commit -m "feat(core): POST /auth/organizer — bootstrap организатора по setup-токену (ADR-012): timing-safe сравнение, rate-limit до проверки, единственность через partial index"
```

---

### Task 6: Псевдонимы гостей

**REQ:** REQ-ID-003 (уточнение амендмента v1.5: имя необязательно, псевдоним назначает сервер), REQ-RWD-011 по духу (CSPRNG вместо Math.random).

**Files:**
- Create: `packages/core/src/membership/pseudonym.ts` + `pseudonym.spec.ts`
- Modify: `packages/core/src/membership/membership.service.ts` (join: необязательное имя + генерация в tx; JoinResult += displayName)
- Modify: `packages/core/src/membership/membership.service.int-spec.ts` (+= кейсы)
- Modify: `packages/core/src/transport/join.controller.ts` (ответ — JoinResponse)

**Interfaces:**
- Consumes: T2 (`joinRequestSchema.displayName` optional, `joinResponseSchema`).
- Produces: `generatePseudonym(taken: ReadonlySet<string>, rnd?: (bound: number) => number): string`; `JoinResult.displayName: string`; join-ответ несёт фактический displayName (потребитель — T9 join-form).

- [ ] **Step 1: Падающие unit-тесты генератора** — `pseudonym.spec.ts`:

```ts
import { generatePseudonym } from './pseudonym';

// Детерминизм — инжекцией rnd (bound) => number. sequence([...]) отдаёт значения по кругу.
const sequence = (values: number[]) => {
  let i = 0;
  return (_bound: number) => values[i++ % values.length];
};

describe('generatePseudonym (ADR-012 §3)', () => {
  it('формат «Слово-NN»: словарное существительное + число 10–99', () => {
    const name = generatePseudonym(new Set(), sequence([0, 32]));
    expect(name).toMatch(/^[А-ЯЁ][а-яё]+-\d{2}$/);
  });
  it('retry при коллизии с активным ростером', () => {
    const first = generatePseudonym(new Set(), sequence([0, 42]));
    const second = generatePseudonym(new Set([first]), sequence([0, 42, 1, 42]));
    expect(second).not.toBe(first);
  });
  it('исчерпание 10–99 по слову ведёт к расширению диапазона 100–999', () => {
    // Все 90 имён «Лиса-10..99» заняты; rnd всегда выбирает «Лиса» и число.
    const taken = new Set(Array.from({ length: 90 }, (_, i) => `Лиса-${10 + i}`));
    const alwaysLisa = (bound: number) => (bound > 50 ? 0 : 0); // словарь[0] = 'Лиса' (алфавитный первый)
    const name = generatePseudonym(taken, alwaysLisa);
    expect(name).toMatch(/^Лиса-(1\d\d|\d{4})$/);
  });
});
```

(Уточнить детерминизм: словарь отсортирован, индекс слова = `rnd(NOUNS.length)`, число = `10 + rnd(90)`, расширение `100 + rnd(900)`.)

- [ ] **Step 2: Прогон — красные** (`pnpm --filter @mymozhem/core test -- pseudonym` — модуль не существует).

- [ ] **Step 3: Реализация** — `pseudonym.ts`:

```ts
import { randomInt } from 'node:crypto';

// Серверные псевдонимы гостей (ADR-012 §3, уточнение REQ-ID-003): система не
// требует реального имени ни в одном сценарии. Словарь — константа (решение
// §0.1 дизайна); случайность — crypto.randomInt, НЕ Math.random (дух REQ-RWD-011).
const NOUNS = [
  'Барсук', 'Белка', 'Ворона', 'Выдра', 'Ёж', 'Журавль', 'Заяц', 'Иволга', 'Кабан', 'Коза',
  'Коршун', 'Кошка', 'Куница', 'Ласка', 'Лиса', 'Лось', 'Мангуст', 'Медведь', 'Нерпа', 'Олень',
  'Орлан', 'Панда', 'Песец', 'Рысь', 'Сайга', 'Соболь', 'Сорока', 'Тигр', 'Уж', 'Филин',
  'Хорёк', 'Цапля', 'Чайка', 'Шакал', 'Щегол', 'Ястреб', 'Бобр', 'Гусь', 'Дрофа', 'Енот',
  'Жерех', 'Зубр', 'Крот', 'Лебедь', 'Мартышка', 'Ондатра', 'Пума', 'Росомаха', 'Сокол', 'Тюлень',
] as const;

export type RandomInt = (bound: number) => number;

// Уникальность — в рамках комнаты (пересечение с активным ростером — retry).
// 5 попыток «Слово-NN» (10–99), затем расширение «Слово-NNN» (100–999);
// теоретическое исчерпание — детерминированный скан suffix от 10 вверх
// (всегда терминирует; на практике недостижим — 50 слов × 990 номеров).
export function generatePseudonym(taken: ReadonlySet<string>, rnd: RandomInt = randomInt): string {
  const word = () => NOUNS[rnd(NOUNS.length)];
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${word()}-${10 + rnd(90)}`;
    if (!taken.has(candidate)) return candidate;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${word()}-${100 + rnd(900)}`;
    if (!taken.has(candidate)) return candidate;
  }
  const base = word();
  for (let suffix = 10; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
```

- [ ] **Step 4: Падающие int-тесты join** — в `membership.service.int-spec.ts` (по образцу существующих кейсов join):

```ts
it('join без displayName: сервер назначает псевдоним «Слово-NN» (Review Focus 2)', async () => {
  const { identity } = await membership.join({ code: room.code, displayName: undefined, ip: '10.0.0.1' });
  expect(identity.displayName).toMatch(/^[А-ЯЁ][а-яё]+-\d+$/);
});
it('два безымянных гостя получают РАЗНЫЕ псевдонимы в одной комнате', async () => {
  const a = await membership.join({ code: room.code, displayName: undefined, ip: '10.0.0.2' });
  const b = await membership.join({ code: room.code, displayName: undefined, ip: '10.0.0.3' });
  expect(a.identity.displayName).not.toBe(b.identity.displayName);
});
it('заданное имя проходит без изменений (свободный ввод сохранён)', async () => {
  const { identity } = await membership.join({ code: room.code, displayName: 'Маша', ip: '10.0.0.4' });
  expect(identity.displayName).toBe('Маша');
});
```

Сигнатура `join` меняется: `displayName?: string` — прогнать typecheck спеков, поправить существующие вызовы (они передают имя — не сломаются).

- [ ] **Step 5: Реализация join** — в `membership.service.ts`:

```ts
// сигнатура:
async join(params: { code: string; displayName?: string; ip: string; role?: 'participant' | 'spectator' }): Promise<JoinResult>
// JoinResult += displayName: string (фактическое имя — заданное или псевдоним).
```

Тело: ранняя валидация только заданного имени (`const providedName = params.displayName === undefined ? undefined : displayNameSchema.parse(params.displayName);` — заменяет строку 202). Внутри `$transaction` до `createGuest`:

```ts
const name = providedName ?? generatePseudonym(await this.takenDisplayNames(tx, room.id));
const identity = await this.identity.createGuest(name, tx);
// ... return { membership, identity, displayName: name };
```

Новый приват:

```ts
// Имена активного ростера комнаты — для retry псевдонима (решение §0.1).
// Чтение в той же tx, что и создание гостя: видим свежие join этого запроса.
private async takenDisplayNames(tx: Prisma.TransactionClient, roomId: string): Promise<Set<string>> {
  const rows = await tx.membership.findMany({
    where: { roomId, deletedAt: null },
    select: { identity: { select: { displayName: true } } },
  });
  return new Set(rows.map((r) => r.identity.displayName).filter((n): n is string => n !== null));
}
```

`join.controller.ts`: тип ответа `Promise<JoinResponse>`, возврат `{ accessToken: ..., tokenType: 'Bearer', expiresIn: ..., displayName }` (displayName из результата join).

- [ ] **Step 6: Прогоны**

```bash
pnpm --filter @mymozhem/core test -- pseudonym
pnpm --filter @mymozhem/core test:int -- membership.service
pnpm --filter @mymozhem/server test   # join-потребители (e2e join/room-flow) — ответ join теперь шире; спеки, парсящие ответ join строго, поправить
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/membership packages/core/src/transport/join.controller.ts apps/server
git commit -m "feat(core): серверные псевдонимы гостей (ADR-012 §3) — displayName необязателен, генератор «Лиса-42» с retry по ростеру, join-ответ несёт фактическое имя"
```

---

## Батч C — механики/клиент/ops (сессия 3)

### Task 7: prize_mode-гейт + lottery v2

**REQ:** REQ-RWD-002b (победитель без сущности приза), REQ-RWD-014 (verified-ветка приостановлена и удалена), REQ-RWD-009 (fulfill/revoke вне гейта), REQ-DEV-007 (аддитивная эволюция payload'ов), REQ-SEC-006 (типизированный PRIZES_DISABLED).

**Files:**
- Modify: `packages/core/src/rewards/rewards.errors.ts` (+= `PrizesDisabledError`), `rewards.service.ts` (конструктор += config; гейты в `createPrize` и `awardPrize`), `rewards.module.ts` (imports ConfigModule, если отсутствует)
- Modify: `packages/core/src/transport/http-exception.filter.ts` (+= `PRIZES_DISABLED: 403`) + спек
- Modify: `packages/core/src/app-runtime/app-runtime.int-spec.ts:645` (ручное конструирование RewardsService += TEST_CONFIG)
- Modify: `packages/app-lottery/src/lottery-events.ts`, `lottery-settings.ts`, `lottery-handlers.ts`, `lottery-state.ts`, `lottery-manifest.ts` (версия 2)
- Modify: `packages/app-lottery/src/lottery-manifest.contract.spec.ts`, `lottery-handlers.spec.ts`, `lottery-state.spec.ts`
- Modify: `apps/server/test/lottery.e2e-spec.ts` (LOTTERY_SETTINGS без drawEligibility; verified-сценарий строки ~352 — удалить; += безпризовой сценарий)
- Modify: `packages/core/src/transport/rooms-lifecycle.controller.int-spec.ts:37` (локальная схема settings без drawEligibility)
- Modify: `packages/core/src/rewards/rewards.int-spec.ts`, `rewards.controller.int-spec.ts` (+= гейт-кейсы)

**Interfaces:**
- Produces: `PrizesDisabledError extends ContractError` (wire `PRIZES_DISABLED`, 403); `LOTTERY_MANIFEST_VERSION = 2`; `drawRunPayload.prizeId?: string`; `drawCompletedPayload.prizeId: string | null`; `LotteryState.draws[*].prizeId: string | null`; `lotterySettingsSchema` = `z.strictObject({})`.

- [ ] **Step 1: Падающие тесты лотереи v2.** `lottery-manifest.contract.spec.ts`: убрать кейсы drawEligibility (61–85), версия манифеста 2; `lottery-handlers.spec.ts`:

```ts
it('безпризовой draw: draw.completed с prizeId=null, БЕЗ эффекта award.prize (REQ-RWD-002b)', () => {
  const result = handleLotteryPublish(ctx({ settings: {} }), 'draw.run', { drawId: UUID1 });
  const completed = result.commits.find((c) => c.shortName === 'draw.completed');
  expect(completed?.payload).toMatchObject({ drawId: UUID1, prizeId: null });
  expect(result.effects).toEqual([]);
});
it('winner-exclusion по ключу null: победитель безпризового розыгрыша вне пула следующего безпризового (решение §0.4)', () => {
  // state.draws = { d0: { prizeId: null, winnerId: P1 } }; pool [P1, P2] → победитель P2
});
it('безпризовые и призовые пулы победителей не пересекаются: приз X не исключает безпризового победителя', () => {
  // state.draws = { d0: { prizeId: null, winnerId: P1 } }; draw.run с prizeId → P1 остаётся в пуле
});
it('replay безпризового drawId: re-emit прежнего результата с prizeId=null, без эффекта', ...);
it('настройка drawEligibility отсутствует: parse({ drawEligibility: 'verified' }) → ZodError (strict)', () => {
  expect(lotterySettingsSchema.safeParse({ drawEligibility: 'verified' }).success).toBe(false);
});
```

- [ ] **Step 2: Реализация лотереи v2**

`lottery-events.ts`:

```ts
export const drawRunPayload = z.strictObject({
  drawId: z.uuid(),
  // ADR-012 §4 / REQ-RWD-002b: розыгрыш без сущности приза — «выбор победителя».
  prizeId: z.uuid().optional(),
});
export const drawCompletedPayload = z.strictObject({
  drawId: z.uuid(),
  prizeId: z.uuid().nullable(),
  winnerId: z.uuid(),
});
```

`lottery-settings.ts` — схема пустеет (verified-ветка удалена, решение §0.6):

```ts
// ADR-012: draw_eligibility удалена (verified-ветка REQ-RWD-014 приостановлена —
// REGISTERED только организатор). Схема сохраняется как точка расширения
// appSettings лотереи; strict — посторонние ключи отклоняются.
export const lotterySettingsSchema = z.strictObject({});
```

`lottery-handlers.ts` — тело после идемпотентности:

```ts
const prizeId = command.prizeId ?? null;
// Прежние победители ЭТОГО приза вне пула; безпризовый розыгрыш исключает
// прежних безпризовых победителей (ключ null, решение §0.4).
const previousWinners = new Set(
  Object.values(ctx.state.draws)
    .filter((d) => d.prizeId === prizeId)
    .map((d) => d.winnerId),
);
const pool = ctx.drawPool.filter((e) => !previousWinners.has(e.identityId));
if (pool.length === 0) throw new AppRejection('DRAW_POOL_EMPTY', 'draw pool is empty');
const winnerId = pool[ctx.randomInt(pool.length)].identityId;
return {
  commits: [
    { shortName: 'draw.run', payload: command, visibility: 'public', actor: 'publisher' },
    { shortName: 'draw.completed', payload: { drawId: command.drawId, prizeId, winnerId }, visibility: 'public', actor: 'server' },
  ],
  // Эффект списания фонда — только при реальном призе; безпризовый draw
  // юридического факта выигрыша не создаёт (ADR-012 §4).
  effects: prizeId ? [{ kind: 'award.prize', prizeId, winnerId }] : [],
};
```

(Ветка settings/verified и `lotterySettingsSchema.parse(ctx.settings)` удаляются; replay-блок уже переизлучает `existing.prizeId` — тип расширяется до nullable.)

`lottery-state.ts`: `draws: Readonly<Record<string, { readonly prizeId: string | null; readonly winnerId: string }>>`.
`lottery-manifest.ts`: `LOTTERY_MANIFEST_VERSION = 2` с комментарием «v2 (ADR-012): prizeId необязателен, draw_eligibility удалена».

- [ ] **Step 3: Прогон лотереи** — `pnpm --filter @mymozhem/app-lottery test && pnpm --filter @mymozhem/app-lottery build` → PASS.

- [ ] **Step 4: Падающие тесты гейта prize_mode** — `rewards.int-spec.ts`:

```ts
describe('prize_mode (ADR-012 §4, решение §0.3)', () => {
  it('off: createPrize → PRIZES_DISABLED', async () => {
    await expect(rewards.createPrize(roomId, organizerId, { name: 'X', quantity: 1 }))
      .rejects.toMatchObject({ code: 'PRIZES_DISABLED' });
  });
  it('on: createPrize работает (конфиг с PRIZE_MODE: on)', ...);
  it('off: award.prize effect отклонён PRIZES_DISABLED, award НЕ создан, quantity не списан', ...);
  it('off: fulfill/revoke существующего award НЕ гейтятся (урегулирование, REQ-RWD-009)', ...);
});
```

(Спеки конструируют RewardsService вручную/через testing-модуль — конфиг подаётся с `PRIZE_MODE: 'off' | 'on'` явно; TEST_CONFIG дефолт off покрывает первый кейс.)

- [ ] **Step 5: Реализация гейта.** `rewards.errors.ts`:

```ts
// ADR-012 §4: призовой режим выключен конфигурацией (дефолт). Не гейтятся:
// fulfill/revoke/list — урегулирование существующих awards (REQ-RWD-009).
export class PrizesDisabledError extends ContractError {
  constructor() {
    super('PRIZES_DISABLED', 'prize mode is off (ADR-012)');
  }
}
```

`rewards.service.ts`: конструктор += `@Inject(APP_CONFIG') private readonly config: AppConfig` (импорты из `../config/...`); первая строка `createPrize` и `awardPrize`:

```ts
if (this.config.PRIZE_MODE === 'off') throw new PrizesDisabledError();
```

`rewards.module.ts`: убедиться, что `ConfigModule` в imports (APP_CONFIG разрешим). `http-exception.filter.ts`: `STATUS_BY_WIRE_CODE` += `PRIZES_DISABLED: 403` + строка спека. `app-runtime.int-spec.ts:645`: `new RewardsService(db.prisma, membership, eventLog, outbox, TEST_CONFIG)`.

- [ ] **Step 6: e2e лотереи.** `lottery.e2e-spec.ts`: `LOTTERY_SETTINGS` = `{}`; удалить verified-сценарий (~352); добавить сценарий безпризового розыгрыша:

```ts
it('безпризовой розыгрыш: draw.run без prizeId → draw.completed с prizeId=null, award НЕ создан', async () => {
  // активная лотерея, 2 гостя; publish lottery.draw.run { drawId } (без prizeId);
  // ждать draw.completed (prizeId null, winnerId ∈ пулу);
  // GET /rooms/:id/rewards → awards пуст;
  // второй безпризовой draw (новый drawId) → победитель ≠ первому (null-ключ, §0.4).
});
```

Плюс кейс Review Focus 3: `draw.run` с prizeId при prize_mode=off (TEST_CONFIG/стенд по умолчанию off) → ack-ошибка `PRIZES_DISABLED`, в логе нет ни `draw.run`, ни `draw.completed` (откат всего dispatch — эффект до коммитов). Если e2e-стенд бутится с TEST_CONFIG-like env — приз для кейса создать нельзя (createPrize тоже загейчен): prizeId берётся произвольный uuid (awardPrize гейт срабатывает до findFirst — порядок строк гарантирует PRIZES_DISABLED, не PRIZE_UNKNOWN; запинать порядок «гейт ДО findFirst» ассертом кода).

- [ ] **Step 7: Прогоны**

```bash
pnpm --filter @mymozhem/core test:int -- rewards
pnpm --filter @mymozhem/core test:int -- app-runtime
pnpm --filter @mymozhem/server test -- lottery.e2e
pnpm build && pnpm boundary-check && pnpm lint && pnpm typecheck && pnpm test
```

- [ ] **Step 8: Commit**

```bash
git add packages/core packages/app-lottery apps/server
git commit -m "feat: prize_mode-гейт и lottery v2 (ADR-012 §4) — PRIZES_DISABLED на createPrize/award.prize при off; prizeId необязателен, draw_eligibility удалена, winner-exclusion по null-ключу"
```

---

### Task 8: Свип += joinIp/Exclusion

**REQ:** REQ-ID-014 (расширение реализации, текст нормы не меняется), REQ-SEC-004 (IP живёт не дольше события + guest_ttl), REQ-ID-006 (живой контур не ослабляется).

**Files:**
- Modify: `packages/core/src/identity/guest-sweep.service.ts` (tx += 2 оператора)
- Modify: `packages/core/src/identity/guest-sweep.int-spec.ts` (+= describe инварианта)
- Modify: `packages/core/src/membership/membership.service.int-spec.ts:296-302` (симуляция свипа синхронизирована с реальным)

**Interfaces:**
- Consumes: ничего из задач среза (самостоятельна в батче C).
- Produces: инвариант «после свипа joinIp=null и Exclusion удалены» (критерий выхода 5).

- [ ] **Step 1: Падающий инвариант-тест** — новый describe в `guest-sweep.int-spec.ts` (по образцу существующих: testcontainer, identity/membership/exclusion сидятся напрямую, `sweepExpiredGuests(now)` вызывается с контролируемым now):

```ts
describe('ADR-012 §3: IP не живёт дольше события + guest_ttl', () => {
  it('свип обнуляет joinIp членств и удаляет Exclusion свипнутой identity', async () => {
    // arrange: комната; гость с createdAt < cutoff, membership.joinIp='10.1.2.3',
    // Exclusion(roomId, identityId гостя, ip='10.1.2.3'); ВТОРОЙ гость свежий
    // (createdAt > cutoff) с membership.joinIp='10.9.9.9' — контрольная группа.
    const swept = await service.sweepExpiredGuests(now);
    expect(swept).toBe(1);
    const membership = await prisma.membership.findUniqueOrThrow({ where: { roomId_identityId: { roomId, identityId: guestId } } });
    expect(membership.joinIp).toBeNull();
    expect(await prisma.exclusion.count({ where: { identityId: guestId } })).toBe(0);
    // живой контур не тронут (REQ-ID-006): IP свежего гостя на месте
    const fresh = await prisma.membership.findUniqueOrThrow({ where: { roomId_identityId: { roomId, identityId: freshId } } });
    expect(fresh.joinIp).toBe('10.9.9.9');
  });
  it('приостановленная гардой identity (открытый award) сохраняет joinIp и Exclusion до следующего свипа', async () => {
    // guard-фейк возвращает [guestId] из hasOpenAwards → swept=0, joinIp на месте, Exclusion на месте
  });
});
```

- [ ] **Step 2: Прогон — красный** (`pnpm --filter @mymozhem/core test:int -- guest-sweep` → joinIp не null).

- [ ] **Step 3: Реализация** — в `guest-sweep.service.ts` внутри tx, после отзыва сессий (строка ~73), ДО re-check C-8.1:

```ts
        // ADR-012 §3: IP живёт не дольше события + guest_ttl — обнуление joinIp
        // членств и удаление Exclusion свипнутых identity в той же tx. Rejoin-блок
        // снимается вместе с записью — осознанно (ADR); живой контур (REQ-ID-006)
        // не тронут: до свипа joinIp/Exclusion работают как прежде.
        await tx.membership.updateMany({
          where: { identityId: { in: sweepIds } },
          data: { joinIp: null },
        });
        await tx.exclusion.deleteMany({
          where: { identityId: { in: sweepIds } },
        });
```

- [ ] **Step 4: Прогон — зелёный + синхронизация симуляции.** `membership.service.int-spec.ts:296-302` симулирует свип вручную (updateMany identity) — дополнить симуляцию обнулением joinIp/удалением Exclusion ИЛИ (лучше) заменить ручную симуляцию вызовом реального `GuestSweepService.sweepExpiredGuests` — выбрать по локальному контексту спеки, зафиксировать выбор в коммите.

```bash
pnpm --filter @mymozhem/core test:int -- guest-sweep && pnpm --filter @mymozhem/core test:int -- membership.service
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/identity packages/core/src/membership
git commit -m "feat(core): свип += joinIp/Exclusion (ADR-012 §3) — IP не живёт дольше события + guest_ttl; приостановка гардой сохраняет IP до разрешения award"
```

---

### Task 9: Web + ops + docs

**REQ:** REQ-ID-003 (UI необязательного имени), REQ-SEC-006 (UX-маппинг новых кодов), REQ-DEV-003 (документы среза). Закрывает критерии выхода 2 (UI-путь bootstrap) и 6 (compose/чеклист).

**Files:**
- Modify: `apps/web/src/pages/landing.tsx` (секция организатора → router-навигация на `/host/login`)
- Create: `apps/web/src/pages/host/host-login-page.tsx`
- Modify: `apps/web/src/App.tsx` (+= route `/host/login`)
- Modify: `apps/web/src/api/endpoints.ts` (+= `bootstrapOrganizer`; `joinRoom` → `joinResponseSchema`)
- Modify: `apps/web/src/pages/play/join-form.tsx` (имя необязательно; сохранять `res.displayName`)
- Modify: `apps/web/src/pages/host/setup-page.tsx` (удалить verified-радио и state drawEligibility; settings `{}`)
- Modify: `apps/web/src/components/winners.tsx` (prizeId null → без «приз …»)
- Modify: `apps/web/src/pages/host/prizes-panel.tsx` (предупреждение о юр. ответственности + кнопка «Разыграть участника» без prizeId; `panelErrorText` += PRIZES_DISABLED)
- Modify: UX-маппинги wire-кодов (`joinErrorText` в `apps/web/src/pages/play/join-form.tsx`, `panelErrorText` в `prizes-panel.tsx`/`setup-page.tsx`/`screen-page.tsx` — найти определения `grep -rn 'function joinErrorText\|function panelErrorText' apps/web/src`): `ORGANIZER_SETUP_INVALID` → «Неверный токен организатора.», `PRIZES_DISABLED` → «Призовой режим выключен на этом сервере.»
- Modify: `apps/web/e2e/smoke.spec.ts` (Шаг 0 → bootstrap через UI; seed-вызов удалён)
- Delete: `apps/server/scripts/e2e-web-seed.mjs`
- Modify: `docker-compose.yml` (OAuth-блок 28–37 → `ORGANIZER_SETUP_TOKEN` :? + `PRIZE_MODE` :-off)
- Modify: `docs/sessions/2026-09-23-ui-slice-smoke-checklist.md` (§0.1 и §1 переписаны под setup-токен), `README.md` (+= quickstart абзац)

**Interfaces:**
- Consumes: T2 (`organizerBootstrapRequestSchema`, `joinResponseSchema`, коды), T5 (endpoint), T7 (lottery v2 payload).
- Produces: критерии выхода 2 и 6; `bootstrapOrganizer(c: ApiClient, input: OrganizerBootstrapRequest): Promise<TokenResponse>`.

- [ ] **Step 1: endpoint-обёртка и типы**

```ts
// endpoints.ts (импорты += organizerBootstrapRequestSchema-тип, joinResponseSchema, JoinResponse):
export const bootstrapOrganizer = (c: ApiClient, input: OrganizerBootstrapRequest): Promise<TokenResponse> =>
  c.call({ method: 'POST', path: '/auth/organizer', body: input, schema: tokenResponseSchema, auth: false });

// joinRoom — ответ теперь несёт фактический displayName (ADR-012 §3):
export const joinRoom = (c: ApiClient, input: JoinRequest): Promise<JoinResponse> =>
  c.call({ method: 'POST', path: '/rooms/join', body: input, schema: joinResponseSchema, auth: false });
```

- [ ] **Step 2: Страница setup-токена** — `host-login-page.tsx` (по образцу join-form: контролируемая форма, busy-гард, `role="alert"`), использует `anonClient`/`hostSession` из `host-session.ts`:

```tsx
// ADR-012 §2: вход организатора — setup-токен из конфигурации инстанса
// (self-hosted норма). Токен НЕ персистится: живёт только в state формы;
// после протухания refresh-сессии вводится заново.
export function HostLoginPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!token || busy) return;
    setBusy(true); setError(null);
    void bootstrapOrganizer(anonClient, { setupToken: token })
      .then((res) => { hostSession.setAccessToken(res.accessToken); navigate('/host'); })
      .catch((err: unknown) => setError(err instanceof ApiError && err.code === 'ORGANIZER_SETUP_INVALID'
        ? 'Неверный токен организатора.' : 'Не удалось войти. Попробуйте ещё раз.'))
      .finally(() => setBusy(false));
  };
  return (
    <main>
      <h1>Вход организатора</h1>
      <form onSubmit={submit}>
        <label>
          Токен организатора
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" disabled={busy} />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy || !token}>Войти</button>
      </form>
    </main>
  );
}
```

`landing.tsx`: секция «Я организатор» — `<Link to="/host/login">Войти по токену организатора</Link>` (router-Link теперь уместен: полная перезагрузка нужна была только OAuth-флоу). `App.tsx` += `<Route path="/host/login" element={<HostLoginPage />} />`.

- [ ] **Step 3: join-form — необязательное имя**

```tsx
// submit: имя не обязательно (ADR-012 §3) — пустое уходит без displayName,
// сервер назначит псевдоним; сохраняем ФАКТИЧЕСКОЕ имя из ответа.
if (!trimmedCode) { setError('Введите код комнаты.'); return; }
void joinRoom(client, trimmedName ? { code: trimmedCode, displayName: trimmedName } : { code: trimmedCode })
  .then((res) => {
    session.setAccessToken(res.accessToken);
    const claims = decodeAccessClaims(res.accessToken);
    if (!claims.roomId) { setError('Ответ сервера без комнаты. Попробуйте ещё раз.'); return; }
    SessionStore.saveGuest({ code: trimmedCode, displayName: res.displayName });
    onJoined(claims.roomId);
  }) ...
// label: «Ваше имя (необязательно)»; placeholder: «Получите псевдоним, если пусто»
```

Vitest-спеки join-form/endpoints (существующие) — обновить под новую схему ответа; += кейс «пустое имя → body без displayName».

- [ ] **Step 4: Лотерея v2 в UI.** `setup-page.tsx`: удалить state `drawEligibility` и оба radio (строки ~44, 155–168); `lotterySettingsSchema.parse({})`. `winners.tsx`:

```tsx
<li key={drawId}>
  {draw.prizeId === null
    ? displayNameOf(names, draw.winnerId)
    : `${displayNameOf(names, draw.winnerId)} — приз ${draw.prizeId}`}
</li>
```

`prizes-panel.tsx`: после формы создания приза — статичное предупреждение и безпризовая кнопка:

```tsx
// ADR-012 §4: создание приза — юридическая ответственность организатора
// (лотереи, налоги). Текст виден всегда: клиент режим не знает, серверный
// гейт отвечает PRIZES_DISABLED при prize_mode=off.
<p>Призовой режим — юридическая ответственность организатора (лотереи, налоги).</p>
// «Разыграть участника»: publish('lottery.draw.run', { drawId }) без prizeId —
// тот же tryStartDrawAttempt-паттерн (pending-гард, crypto.randomUUID).
```

- [ ] **Step 5: Smoke.** `smoke.spec.ts`: Шаг 0 и seed удаляются; вход организатора — через UI: `host.goto('/')` → ссылка «Войти по токену организатора» → `/host/login` → fill password → «Войти» → `waitForURL('**/host/new')`. Токен стенда — из env `ORGANIZER_SETUP_TOKEN` (прогон передаёт то же значение, что compose; CI-шаг seed больше не нужен — удалить из CI-джоба, если там отдельный seed-шаг: `grep -rn 'e2e-web-seed\|E2E_REFRESH_TOKEN' .github/`). Удалить `apps/server/scripts/e2e-web-seed.mjs`.

- [ ] **Step 6: Compose и docs.** `docker-compose.yml` — заменить блок 28–37:

```yaml
      # ADR-012 §2: bootstrap единственного организатора инстанса. Обязателен
      # (>=32 байта); без значения в окружении compose не стартует.
      ORGANIZER_SETUP_TOKEN: ${ORGANIZER_SETUP_TOKEN:?ORGANIZER_SETUP_TOKEN is required (>=32 bytes)}
      # ADR-012 §4: призовой режим выключен по умолчанию; on — юридическая
      # ответственность организатора (лотереи, налоги).
      PRIZE_MODE: ${PRIZE_MODE:-off}
```

Smoke-чеклист: §0.1 → «Setup-токен стенда» (значение в env стенда; наблюдаемый результат — `curl -s -X POST http://<origin>/auth/organizer -H 'content-type: application/json' -d '{"setupToken":"…"}'` → 200 + `Set-Cookie: mm_refresh`); §1 → «Вход организатора по setup-токену» (лендинг → ссылка → ввод токена → `/host/new`; негатив: неверный токен → «Неверный токен организатора.»); §0.2 (shared refresh-кука) и §0.3 (LAN crypto.randomUUID) сохраняются. README += абзац quickstart (self-hosted: `ORGANIZER_SETUP_TOKEN=… docker compose up -d --build`, вход организатора по токену, `PRIZE_MODE=off` по умолчанию).

- [ ] **Step 7: Прогоны**

```bash
pnpm --filter @mymozhem/web test && pnpm --filter @mymozhem/web build
docker compose up -d --build && ORGANIZER_SETUP_TOKEN='<стендовое>' pnpm --filter @mymozhem/web test:e2e
# Expected: vitest PASS; playwright smoke PASS (прогон против compose-стенда — локальный, не прод)
pnpm build && pnpm boundary-check && pnpm guardrails && pnpm lint && pnpm typecheck && pnpm test
```

- [ ] **Step 8: Commit**

```bash
git add apps/web apps/server docker-compose.yml docs/sessions/2026-09-23-ui-slice-smoke-checklist.md README.md
git commit -m "feat(web,ops): вход организатора по setup-токену, необязательное имя гостя, безпризовый розыгрыш (ADR-012); compose/README/чеклист под zero-PII дефолт"
```

---

## Self-review (зафиксировано для ревью владельцем)

**Spec coverage:** §1→T1, §2→T2, §3→T3 (+миграция в T4), §4→T4, §5→T5, §6→T6, §7→T7, §8→T8, §9→T9, §10→батчи A/B/C, §11 — вне объёма (соблюдено: REQ-ID-012 только маркер в T1). Все 6 критериев выхода покрыты: (1) T4 шаг 5 grep+гейты; (2) T5; (3) T6; (4) T7; (5) T8; (6) T9.

**Интерпретации плана:**
- **I-1:** миграция `drop_identity_provider` переехала T3 → T4 (цепочка компиляции schema.prisma → клиент → identity.service → oauth.service не должна рваться между коммитами).
- **I-2:** ответ join расширяется `displayName` (новая `joinResponseSchema`), а не «клиент читает ростер» — авто-rejoin'у нужно фактическое имя сразу, до первого listMembers.
- **I-3:** `PrizesDisabledError extends ContractError` (паттерн rewards.errors); гейт ставится ДО `findFirst` приза — при off ответ всегда `PRIZES_DISABLED`, не `PRIZE_UNKNOWN` (запинано в T7 шаг 6).
- **I-4:** старый частичный индекс `Identity_registered_email_key` (lower(email)) НЕ удаляется: безнадёжен при email=NULL, но безвреден и понадобится при возврате аккаунтов (триггер ADR-012); новый индекс — отдельной строкой той же миграции.
- **I-5:** `lotterySettingsSchema` сохраняется как пустой `strictObject({})` — манифесту нужна settings-схема, а удаление ключа appSettings меняло бы defineApp-контракт без выигрыша.
- **I-6:** `.env` вне git — удаление Google-кредов из него и отзыв клиента в Google Cloud (решение §0.7) — действия владельца после мерджа, в план не включены как шаги.

**Placeholder scan:** код приведён для всех нетривиальных шагов; скелеты e2e/int-спек даны по именам сценариев с ассертами — детали бута делегированы образцам (oauth.e2e-spec/guest-sweep.int-spec), это соответствует уровню детализации прежних планов репозитория.

**Type consistency:** `OrganizerBootstrapRequest`, `JoinResponse`, `generatePseudonym(taken, rnd)`, `findOrCreateOrganizer()`, `setupTokenMatches(provided, expected)`, `ORGANIZER_BOOTSTRAP_RATE_LIMITER`, `PrizesDisabledError` — имена согласованы между задачами (T2→T5/T6/T9, T3→T5/T7, T4→T5).

**Review Focus:** все 5 строк имеют пин-тесты в задачах-владельцах (T5 шаги 3/5, T6 шаг 4, T7 шаг 6, T8 шаг 1).
