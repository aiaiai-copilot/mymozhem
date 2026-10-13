# Task 6 Report — `GET /metrics` + boundary-правила observability

## What I implemented

- `packages/core/src/observability/metrics.controller.ts` — `GET /metrics`, открытый (решение владельца, дизайн ф.4 §0.3), структурный `MetricsReply` (ReplyLike-прецедент, core не знает fastify), Content-Type из registry, body = `MetricsService.render()`.
- `packages/core/src/observability/observability.module.ts` — `ObservabilityModule` (imports/exports `MetricsModule`, controllers `[MetricsController]`).
- `packages/core/src/observability/observability.int-spec.ts` — int-спека по образцу rewards.controller.int-spec (fastify-адаптер, `Test.createTestingModule`, override APP_CONFIG → TEST_CONFIG), дерево `ConfigModule, ObservabilityModule`, без БД.
- `packages/core/src/index.ts` — barrel-экспорт `observability.module`.
- `.dependency-cruiser.cjs` — правила `observability-is-leaf` и `observability-libs-contained`.
- `scripts/verify-guardrails.mjs` — probes 9 (observability → room) и 10 (prom-client вне observability) с записью probe-файлов и удалением в `finally`.

## TDD Evidence

**RED** — `pnpm --filter @mymozhem/core test:int -- observability.int-spec`:
```
FAIL src/observability/observability.int-spec.ts
  error TS2307: Cannot find module './observability.module'
Test Suites: 1 failed
```
Ожидаемо: модулей контроллера/фасада ещё нет (спека написана первой).

**GREEN** — та же команда после реализации:
```
PASS src/observability/observability.int-spec.ts
  ✓ GET /metrics — 200, text format, 4 метрики REQ-OPS-004
  ✓ GET /metrics не требует авторизации
Tests: 2 passed, 2 total
```

## Gates (Step 7)

- `pnpm run guardrails` — все 10 probes OK, "All guardrails verified alive."
- `pnpm build` — 6/6 successful.
- `pnpm run boundary-check` — no dependency violations (725 modules, 2278 deps, включая dist).
- `eslint src/observability` — чисто.

## Files changed

- Create: `packages/core/src/observability/metrics.controller.ts`
- Create: `packages/core/src/observability/observability.module.ts`
- Create: `packages/core/src/observability/observability.int-spec.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `.dependency-cruiser.cjs`
- Modify: `scripts/verify-guardrails.mjs`

Commit: `27becbb feat(core): GET /metrics (open, REQ-OPS-004) + observability boundary rules and probes`

## Deviation from brief (с основанием)

Бриф предписывал в `observability-is-leaf` `pathNot: '[.]spec[.]ts$'` verbatim, но та же спека из Step 1 импортирует `TEST_CONFIG` из `../testing/test-config` — а `[.]spec[.]ts$` не матчит `.int-spec.ts` (перед `spec` стоит `-`, не `.`). Проверено эмпирически: с verbatim-регуляркой boundary-check падает на самой спеке (`observability.int-spec.ts → testing/test-config.ts`). Исправлено по прецеденту `rewards-only-through-di-tokens` (int-spec = миниатюра composition root): `pathNot: ['[.]spec[.]ts$', '[.]int-spec[.]ts$']` с комментарием. Семантика правила (продакшн-код observability — лист) не изменена.

## Self-review findings

- Дифф перечитан: 6 файлов, +145 строк, ничего лишнего.
- Probe 9 (`observability → ../room/room.module`) матчит только `observability-is-leaf` (room не импортирует observability — цикла нет); probe 10 (`prom-client` из room) — только `observability-libs-contained`. Оба подтверждены `expectFailure` по имени правила, не вакуумно.
- Промах при редактировании .dependency-cruiser.cjs в ходе работы (временно удалил тело `no-circular`) пойман и исправлен до коммита; финальный дифф чист.
- `@Res()` переводит хэндлер в library-specific режим — осознанно (Content-Type из registry), перехватчики Nest для /metrics не нужны.

## Issues / concerns

- `ObservabilityModule` экспортирован из barrel, но не подключён в composition root `apps/server` — по плану это, видимо, проводка батча C (pino-конфигурация там же). Вне объёма задачи.
