# Task 2 report — Config: токен/транспорт параметры с инвариантами

**Status:** DONE
**Commit:** `5e3609d` — `feat(core): token/transport config params with cross-invariants (REQ-SEC-002, REQ-OPS-003, REQ-ID-016)`
**Branch:** `phase-1-transport-http-auth`

## Что сделано

1. **`packages/core/src/config/config.schema.ts`** — добавлены 7 полей verbatim по брифу: `JWT_SECRET` (обязателен, `min(32)`, REQ-SEC-002), `ACCESS_TOKEN_TTL` (60..3600, default 900), `GUEST_TTL` (3600..2 592 000, default 86 400), `REFRESH_TOKEN_TTL` (≥60, default 86 400), `REFRESH_RATE_LIMIT` (≥1, default 10, REQ-SEC-007), `TRUST_PROXY` (enum true/false → boolean, default false), `CORS_ORIGINS` (csv → `string[]`, default []). Кросс-инварианты — `.superRefine` после `z.object`: `REFRESH_TOKEN_TTL <= GUEST_TTL` (REQ-ID-016) и запрет CORS wildcard в production (REQ-SEC-008). Существующих superRefine/transform в схеме не было — интегрировать не с чем было, ничего не сломано. Комментарии с REQ-цитатами сохранены в стиле файла.
2. **`packages/core/src/config/config.schema.spec.ts`** — `base` дополнен `JWT_SECRET: 's'.repeat(32)` (нагружающая инструкция брифа: без этого падают все существующие тесты). Добавлены 6 новых тестов из брифа verbatim (missing/short JWT_SECRET, REFRESH>GUEST, CORS wildcard в prod, transport defaults, парсинг TRUST_PROXY/CORS_ORIGINS).
3. **`packages/core/src/testing/test-config.ts`** — в `TEST_CONFIG` добавлены 7 полей по брифу. Длина `JWT_SECRET: 'test-only-secret-key-32-bytes-long!!'` проверена: **36 символов** (≥32 — ок).

## Отступления от брифа

Нет функциональных. Форматирование: брифовский однострочник `CORS_ORIGINS` transform разбит prettier-стилем на многострочный (соответствует окружающему коду), `.superRefine` блок отформатирован с отступом продолжения — семантика идентична.

## TDD-хронология и вывод команд

- **Red:** `pnpm --filter @mymozhem/core test -t loadConfig` — падение: TS2339 `Property 'ACCESS_TOKEN_TTL' ... does not exist` и т.д. (7 ошибок компиляции в spec), `Test Suites: 1 failed`.
- **Green:** та же команда после реализации — `PASS src/config/config.schema.spec.ts`, `Tests: 16 passed`.
- **Full core lane:** `pnpm --filter @mymozhem/core test`:

```
Test Suites: 7 passed, 7 total
Tests:       89 passed, 89 total
```

  Обязательный `JWT_SECRET` ничего не сломал: все внешние потребители `AppConfig` идут через `TEST_CONFIG` (обновлён), других прямых вызовов `loadConfig` вне spec нет.
- **Type-check:** `tsc --noEmit -p packages/core/tsconfig.json` — exit 0.

## Self-review

- REQ-покрытие: REQ-SEC-002 (required + min 32, тесты missing/short), REQ-OPS-003 (всё в единой схеме, кросс-инварианты валидируются на старте через `loadConfig`), REQ-ID-016 (superRefine + тест), REQ-SEC-008 (superRefine + тест), REQ-SEC-007 (`REFRESH_RATE_LIMIT`, default 10). Все перечисленные в брифе REQ закрыты кодом и тестами.
- Zod v4: `ctx.addIssue({ code: 'custom', ... })` — валидный API v4; кодовая база ранее `addIssue` не использовала, конфликта стиля нет.
- Новых зависимостей не добавлено, lockfile не тронут.
- Замечание (не блокер): существующий тест `throws when DATABASE_URL is missing` вызывает `loadConfig({})` и матчит `/DATABASE_URL/` — сообщение об ошибке теперь содержит оба отсутствующих поля, тест остаётся корректным.

## Concerns

Нет.
