# Task 9 Report: packages/app-lottery — второй app-модуль (лотерея)

**Status:** DONE_WITH_CONCERNS (один concern по семантике дефолта settings, см. ниже)
**Коммит:** `2a5f17a` — feat(app-lottery): модуль лотереи — draw.run/draw.completed, eligibility, идемпотентность drawId

## Что реализовано

Новый workspace-пакет `packages/app-lottery` — зеркало `packages/app-quiz` по инфраструктуре:

- **Манифест** (`lottery-manifest.ts`, verbatim бриф): `appId 'lottery'`, `manifestVersion 1`, `capabilities: ['rewards']`, события `draw.run` (public, clientInitiated) и `draw.completed` (public, server-only), appSettings = `lotterySettingsSchema`.
- **Settings** (`lottery-settings.ts`, verbatim): `drawEligibility: 'guests_allowed' | 'verified'`, дефолт `guests_allowed`, `x-visibility: public` (REQ-RWD-014).
- **События** (`lottery-events.ts`, verbatim): `drawRunPayload` / `drawCompletedPayload` — strictObject, `z.uuid()` для drawId/prizeId/winnerId.
- **Редьюсер** (`lottery-state.ts`, verbatim): чистая проекция `LotteryState { draws }` из лога (REQ-CORE-004), дедупликация по drawId — no-op с сохранением ссылки (идемпотентность replay/live, REQ-RWD-003).
- **Обработчик** (`lottery-handlers.ts`, verbatim): `handleLotteryPublish` — гейт ORGANIZER (PUBLISH_FORBIDDEN), парс команды, идемпотентность по drawId (re-emit draw.completed без эффекта, design §4), eligibility-фильтр пула (verified отсекает GUEST), исключение прежних победителей приза, DRAW_POOL_EMPTY до коммита, выбор только через `ctx.randomInt` (REQ-RWD-011), эффект `award.prize` в AppPublishResult.
- **Runtime** (`lottery-runtime.ts`, verbatim): `createLotteryRuntime()` / `createLotteryApp()` — фабрики чистые, без module-level мутабельного состояния.
- **Инфраструктура**: package.json — полное зеркало app-quiz (ruling 1: scripts build/typecheck/lint/test, devDeps дословно включая `@types/node ^24.0.0`); tsconfig.json и jest.config.js — дословные копии. Регистрация в eslint-конфиге не потребовалась: корневой flat config покрывает `**/*.ts` автоматически (проверено: `pnpm lint` прогнал `@mymozhem/app-lottery:lint`). Регистрация в composition root — вне задачи (Task 11).

## Тесты и результаты

34 теста в 3 файлах, все зелёные:

- `lottery-state.spec.ts` (2): идемпотентность drawId (та же ссылка на дубле; конфликт winnerId игнорируется), no-op на неизвестном типе.
- `lottery-handlers.spec.ts` (10): все 8 кейсов брифа verbatim + 2 wiring-теста runtime (зеркало quiz-handlers.spec.ts:338-368).
- `lottery-manifest.contract.spec.ts` (22): appManifestSchema, identity, capabilities === ['rewards'], точный набор типов с visibility/clientInitiated, Ajv2020-компиляция зарегистрированных схем (appSettings + payload-кейсы draw.run/draw.completed включая отказ невалидного uuid и лишних ключей), readPropertyVisibility drawEligibility = public, zod-дефолт guests_allowed.

Финальные прогоны:

- `pnpm --filter @mymozhem/app-lottery test` — **34/34 PASS** (3 suites)
- `pnpm --filter @mymozhem/app-lottery build` — OK
- `pnpm --filter @mymozhem/app-lottery typecheck` — OK
- `pnpm boundary-check` — OK (616 modules, 0 violations; app-lottery под правилом app-only-through-sdk автоматически)
- `pnpm lint` — OK (5 пакетов, включая app-lottery)

## TDD-доказательства

**RED** (после создания инфраструктуры и трёх spec-файлов, до реализации):

```
$ pnpm install  # новый workspace-пакет
$ pnpm --filter @mymozhem/app-lottery test
FAIL src/lottery-state.spec.ts / lottery-handlers.spec.ts / lottery-manifest.contract.spec.ts
  error TS2307: Cannot find module './lottery-state' / './lottery-handlers' / './lottery-manifest' ...
Test Suites: 3 failed, 3 total
Tests: 0 total
```

**GREEN** (после реализации verbatim-блоков брифа + одной правки теста, см. ниже):

```
$ pnpm --filter @mymozhem/app-lottery test
Test Suites: 3 passed, 3 total
Tests: 34 passed, 34 total
```

## Изменённые файлы (все в коммите 2a5f17a)

- `packages/app-lottery/package.json`, `tsconfig.json`, `jest.config.js` (новые)
- `packages/app-lottery/src/lottery-settings.ts`, `lottery-events.ts`, `lottery-manifest.ts`, `lottery-state.ts`, `lottery-handlers.ts`, `lottery-runtime.ts`, `index.ts` (новые, verbatim бриф)
- `packages/app-lottery/src/lottery-state.spec.ts`, `lottery-handlers.spec.ts`, `lottery-manifest.contract.spec.ts` (новые)
- `pnpm-lock.yaml` (+28 строк: только importer-запись packages/app-lottery, один lockfile — REQ-DEV-002)

## Отклонения от брифа (с обоснованием)

1. **package.json дополнен до полного зеркала app-quiz** (scripts typecheck/lint, devDep @types/node) — санкционировано ruling 1 контроллера.
2. **Один тест в manifest.contract.spec изменён от моей первоначальной трактовки брифа.** Бриф требует «дефолт guests_allowed»; я изначально написал кейс «зарегистрированная схема принимает `{}`». Прогон показал: `z.toJSONSchema` (output-режим, как в `defineApp`) помечает defaulted-поле как `required`, и ядро валидирует verdict-only без коэрсии (app-registry.service.ts:40 «Verdict-only: никакой коэрсии и мутации входа») — то есть `{}` **отклоняется** зарегистрированным артефактом. Тест переписан на фактическое поведение: `validate({}) === false`, валидны явные значения enum; дефолт пинится на zod-уровне (`lotterySettingsSchema.parse({}).drawEligibility === 'guests_allowed'` — это путь защитного parse в handler'е). Реализация при этом verbatim брифу, не менялась.
3. **+2 wiring-теста** createLotteryRuntime/createLotteryApp в handlers-spec — зеркало структуры quiz-handlers.spec.ts.

## Self-review находки

- Импорты только `@mymozhem/sdk` и `zod` — boundary-check подтверждает; `Math.random` отсутствует (только verbatim-комментарий брифа).
- UUID-фикстуры (D0/D1/P1/W1/W2/W3) — валидные v4 (version nibble 4, variant 8/9/a), `z.uuid()` принимает.
- Ajv2020 при компиляции event-схем печатает warning `unknown format "uuid" ignored` (strict:false, ajv-formats нет и у app-quiz — зеркало сохранено, новых devDeps не добавлял). Вердикты корректны: zod v4 эмитит `pattern` наряду с `format`, кейсы отказа невалидных uuid проходят по pattern. Шум в консоли теста — приемлем, поведение идентично будущему quiz при добавлении uuid-полей.
- Идемпотентность проверяется ДО проверки пула (verbatim бриф): повтор drawId re-эмитит draw.completed даже при опустевшем пуле — осознанное self-healing поведение design §4.
- Lockfile-дифф чистый, дерево после коммита чистое.

## Concerns

1. **Семантика дефолта settings (низкая, для сведения владельца/плана).** Из-за output-режима `z.toJSONSchema` в `defineApp` зарегистрированная JSON Schema требует `drawEligibility` явно — клиент обязан всегда передавать ключ, несмотря на наличие zod-дефолта `guests_allowed`. Это свойство SDK (defineApp, Task 2), не app-lottery; quiz не имеет defaulted-полей, прецедента не было. Поведение зафиксировано тестом; если желаемая семантика — «дефолт применяется ядром при configure», это отдельный вопрос к SDK (io: 'input' в toRegisteredSchema), выходящий за рамки задачи и, вероятно, требующий решения владельца. Для MVP безопасно: composition root/seed будет передавать settings явно, handler защитно применяет дефолт.
