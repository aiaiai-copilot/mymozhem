# Task 6 Report — apps/web scaffold + boundary + static-serving + compose

**Status:** DONE_WITH_CONCERNS (одна осознанная архитектурная дивергенция от брифа, см. ниже)
**Commit:** `8369174` — `feat(web): scaffold apps/web (Vite+React) + boundary-правила + same-origin static-serving (UI-срез)`

## What I implemented

1. **`apps/web` scaffold** — пакет `@mymozhem/web` (Vite 8 + React 19 + react-router-dom 7): `package.json` (скрипты дословно по брифу), `vite.config.ts` (dev-proxy на :3000 для `/rooms` `/auth` `/health` `/socket.io`+ws — same-origin, CORS нигде не добавлялся), `tsconfig.json` (extends base; переопределены module/moduleResolution/jsx/lib/types/noEmit), `index.html` (viewport mobile-first), `src/main.tsx` + `src/App.tsx` (router с 4 маршрутами-заглушками `/`, `/host/*`, `/play/:code?`, `/screen/:code` → `<p>tbd</p>`), `src/styles.css` (минимальный reset). Зависимости — только через `pnpm add` (один lockfile, REQ-DEV-002); `@fastify/static@^9` добавлен в apps/server.
2. **Boundary-правила** в `.dependency-cruiser.cjs` после `app-only-through-sdk`: `web-only-through-sdk-and-app-packages` и `web-socketio-only-in-realtime` — дословно по брифу. Плюс минимальная правка `options.enhancedResolveOptions` (см. «Дивергенции»).
3. **Guardrails probes 6 и 7** в `scripts/verify-guardrails.mjs` по существующему паттерну (writeFileSync → expectFailure → rmSync в finally).
4. **`WEB_STATIC_DIR: z.string().min(1).optional()`** в `config.schema.ts` с русским why-комментарием.
5. **E2E `apps/server/test/static-web.e2e-spec.ts`** — 4 кейса из брифа, boot по паттерну health.e2e (PrismaService заглушен, мёртвый порт DATABASE_URL — без testcontainers), tmp-директория с index.html-маркером.
6. **Static-serving**: `apps/server/src/static-web.ts` (`registerStaticWeb`) + вызов в `main.ts`.
7. **docker-compose**: `WEB_STATIC_DIR: /app/apps/web/dist` в server.environment (Dockerfile не менялся — build-стейдж `pnpm run build` собирает web турбо-таской, runtime копирует весь /app).

## Test results

- `pnpm run boundary-check` → **green** (`no dependency violations found (654 modules, 2015 dependencies)`); .tsx парсится (проверено: `depcruise apps/web/src` показывает зависимости App.tsx/main.tsx на react, react-router-dom и др.).
- `pnpm run guardrails` → **все 7 probes firing**, включая новые:
  - `OK — guardrail fired on: web → core import (dependency-cruiser)`
  - `OK — guardrail fired on: socket.io-client outside web/src/realtime (dependency-cruiser)`
  - Дополнительно проверено вручную, что probes стреляют ИМЕННО целевыми правилами (`web-only-through-sdk-and-app-packages` / `web-socketio-only-in-realtime`), а не побочными.
- `pnpm run build` / `typecheck` / `lint` (root, turbo) → **green, 6/6 пакетов**, web включён; `apps/web` build производит `dist/` (index.html + assets).
- `pnpm --filter @mymozhem/web test` → exit 0 (`No test files found, exiting with code 0` — `passWithNoTests`).
- `pnpm --filter @mymozhem/server test health` → 3/3 green (smoke: config-изменение не сломало boot).

## TDD Evidence (static-serving e2e)

**RED** — тест написан до реализации; команда `pnpm build && pnpm --filter @mymozhem/server test static-web`:
```
FAIL test/static-web.e2e-spec.ts
  ● Test suite failed to run
    test/static-web.e2e-spec.ts:11:35 - error TS2307: Cannot find module '../src/static-web' ...
Tests: 0 total
```
Ожидаемо: модуля `src/static-web` ещё нет (compile-red для нового модуля).
Промежуточный red после первой реализации (inline-порядок из брифа): `Not found handler already set for Fastify instance with prefix: '/'` — Nest при init ставит свой not-found handler, fastify запрещает второй на том же префиксе; затем, после переноса в encapsulated scope, падал кейс 2 (`GET /host/console` → 404 вместо index.html) из-за порядка avvio-очереди. Обе находки привели к финальной конструкции (см. дивергенцию).

**GREEN** — `pnpm build && pnpm --filter @mymozhem/server test static-web`:
```
PASS test/static-web.e2e-spec.ts
  Static web (same-origin SPA, e2e)
    ✓ GET / → index.html (SPA) (17 ms)
    ✓ GET /host/console (не-API GET) → index.html (SPA fallback) (4 ms)
    ✓ GET /rooms/nonexistent (API-путь) → JSON 404, НЕ index.html (1 ms)
    ✓ GET /socket.io/… → не index.html (2 ms)
Tests: 4 passed, 4 total
```
Review Focus 5 запинен: SPA-fallback отдаёт index.html только для не-API GET; `/rooms/...` и `/socket.io/...` получают JSON 404. Механизм дополнительно воспроизведён на чистом fastify (standalone-скрипт: все 4 перехода поведения подтверждены).

## Files changed

- Create: `apps/web/{package.json,vite.config.ts,tsconfig.json,index.html,src/main.tsx,src/App.tsx,src/styles.css}`
- Create: `apps/server/src/static-web.ts`, `apps/server/test/static-web.e2e-spec.ts`
- Modify: `.dependency-cruiser.cjs` (2 правила + enhancedResolveOptions), `scripts/verify-guardrails.mjs` (probes 6–7), `packages/core/src/config/config.schema.ts` (WEB_STATIC_DIR), `apps/server/src/main.ts` (init + registerStaticWeb), `apps/server/package.json` (@fastify/static ^9.3.0), `docker-compose.yml` (WEB_STATIC_DIR), `pnpm-lock.yaml` (только через pnpm)

## Divergences from the brief (с причинами)

1. **Логика раздачи вынесена из main.ts в `apps/server/src/static-web.ts` (`registerStaticWeb`)**, main.ts вызывает helper. Причина: существующие e2e «зеркалят» bootstrap вручную — для тривиальных регистраций это ок, но SPA-fallback (Review Focus 5) — нетривиальная логика, и зеркало тестировало бы копию, а не production-код. Helper вызывается и из main.ts, и из e2e.
2. **`setNotFoundHandler` — в encapsulated-контексте `{ prefix: '/' }`, а не на корне, и вызов ПОСЛЕ `await app.init()`.** Причина (вскрыта red-прогонами): Nest при init ставит собственный not-found handler на корень (RoutesResolver.registerNotFoundHandler), причём отложенно через avvio-очередь; fastify запрещает второй handler на том же префиксе в том же контексте («Not found handler already set»). Контекст с prefix '/' получает собственный 404-уровень (arrange404) и его handler выигрывает у корневого — но только если встал в avvio-очередь позже корневого, отсюда явный `app.init()` перед `registerStaticWeb` в main.ts (listen после ручного init — штатный Nest-паттерн, init идемпотентен). Всё это задокументировано русскими why-комментариями в static-web.ts и main.ts.
3. **`options.enhancedResolveOptions` в `.dependency-cruiser.cjs`** (бриф допускал «минимальную правку options»): depcruise по умолчанию игнорирует package.json `exports` (exportsFields: []) и имеет пустые conditionNames; @vitejs/plugin-react@6 публикует вход только через exports, а zod — только через условные exports без default. Без `exportsFields: ['exports']` + `conditionNames: ['types','import','require','node','default']` — ложный not-to-unresolvable (1 ошибка без exports, 142 — с exports но без conditionNames). С обеими правками — чисто.
4. **`@fastify/static@^9`** вместо latest: @nestjs/platform-fastify декларирует peer `^8 || ^9`; v10 давал unmet-peer warning. С ^9 `pnpm peers check` чист.
5. **`passWithNoTests: true`** в vite.config test (скрипт `vitest run` оставлен дословно): до батчей C/D спек нет, а turbo-гейт `test` обязан оставаться зелёным. С why-комментарием.
6. **`lib: ["ES2023","DOM","DOM.Iterable"]`** в web tsconfig (базовый lib серверный, без DOM — typecheck не проходил); также `declaration/sourceMap: false` (бессмысленны при noEmit).
7. **Кейс 3 e2e** использует дословный путь брифа `/rooms/nonexistent` (один сегмент — не матчится ни на один реальный GET-роут; проверено по transport-контроллерам).

## Self-review findings

- CORS нигде не добавлялся и не менялся (существующая регистрация `origin: config.CORS_ORIGINS` не тронута; dev — Vite-proxy, prod — same-origin).
- Первичная правка config.schema.ts случайно снесла строку комментария — поймана `git diff`, восстановлена; финальный diff аддитивен (3 строки).
- eslint для web: отдельный конфиг НЕ создан — корневой flat-config покрывает `eslint src` (проверено зелёным прогоном, .tsx парсится tseslint).
- Lockfile менялся только командами `pnpm add`.
- Комментарии в коде — по-русски, про «почему».

## Concerns

1. **API-404 при включённой статике отдаёт `{ code: 'NOT_FOUND' }`** (как в брифе), а существующая wire-конвенция для неизвестных роутов (без статики) — `{ code: 'REQUEST_INVALID' }` из catch-all HttpExceptionFilter. Код 404-ошибки таким образом зависит от режима. E2E это сознательно не пинит (assert'ит 404 + JSON + не-marker). Если владелец хочет единый wire-код — однострочная правка.
2. **`main.ts` теперь вызывает `app.init()` явно** — ни один существующий тест не гоняет сам main.ts (bootstrap), риск низкий (идемпотентный, задокументированный паттерн), но отмечаю.
3. `pnpm run test` на корне не прогонялся целиком (testcontainers-сьюты) — не требуется брифом; прогнаны focused static-web + health smoke.

---

## Fix report — review round 1 (Critical: probe 6 проходил вакуумно)

**Finding:** probe 6 (`apps/web → core`) матчил ДВА forbidden-правила — новое `web-only-through-sdk-and-app-packages` и существующее `apps-only-through-core-entrypoint`; `expectFailure` проверял лишь ненулевой exit code, поэтому при удалении/поломке нового правила `pnpm run guardrails` оставался бы зелёным за счёт соседнего — новое правило не имело регрессионной защиты.

**Commit:** `fca5c2e` — `fix(guardrails): probes assert rule names in depcruise output (UI-срез, review round 1)`

### What changed

`scripts/verify-guardrails.mjs` (единственный файл, +19/−2):
- `expectFailure(label, cmd, expectOutput)` — третий обязательный аргумент: при падении команды stdout+stderr (stdio уже piped) обязаны содержать ожидаемый сигнал; иначе `FAIL — guardrail fired, но без ожидаемого сигнала …` и exit 1. Why-комментарий по-русски описывает вакуумный сценарий.
- Сигналы на всех probes (depcruise — имя правила; eslint — REQ-маркер из message):
  1. sdk → core: `sdk-is-leaf`
  2. mutable export (eslint): `REQ-CORE-004`
  3. apps → core src: `apps-only-through-core-entrypoint`
  4. core → rewards: `rewards-only-through-di-tokens`
  5. Math.random (eslint): `REQ-RWD-011`
  6. web → core: `web-only-through-sdk-and-app-packages`
  7. socket.io-client вне realtime: `web-socketio-only-in-realtime`

### Verification

1. **Green с правилами на месте** — `pnpm run guardrails` → exit 0, все 7 probes `OK`, финал `All guardrails verified alive.`
2. **Негативная проверка механизма** — assertion probe 6 временно указан на `nonexistent-rule-name`:
   `pnpm run guardrails` → exit **1**, `FAIL — guardrail fired, но без ожидаемого сигнала "nonexistent-rule-name" on: web → core import (dependency-cruiser)` + баннер `Guardrails are NOT enforcing.` Затем revert.
3. **Проверка исходного сценария ревью** — правило `web-only-through-sdk-and-app-packages` временно УДАЛЕНО из `.dependency-cruiser.cjs` (соседнее `apps-only-through-core-entrypoint` осталось и продолжает стрелять на тот же импорт):
   `pnpm run guardrails` → exit **1**, `FAIL — guardrail fired, но без ожидаемого сигнала "web-only-through-sdk-and-app-packages" on: web → core import …` — ранее этот сценарий проходил зелёным. Затем revert (`git checkout -- .dependency-cruiser.cjs`, правило на месте).
4. **Финальный прогон** — `pnpm run guardrails` → exit 0 (7/7 OK); `pnpm run boundary-check` → `✔ no dependency violations found (654 modules, 2015 dependencies cruised)`.

### Notes

- Probes 2/5 (eslint) разделяют механизм `expectFailure`, поэтому получили assertions на свой ожидаемый сигнал (REQ-маркер из текста message) — по рекомендации координатора.
- Других правок по итогам ревью не потребовалось (SPA-fallback, enhancedResolveOptions, @fastify/static ^9 — approved).

---

## Final-review fix wave

Финревью батча 2 (Tasks 4–6, whole-batch): вердикт «With fixes» — 1 Important + 2 Minor, все признаны actionable контроллером. Исполнено одним коммитом.

**Commit:** `cf17671` — `fix(web): пин react 18/react-router 6 по плану + порядок ростера + boundary web-no-cross-app-imports (UI-срез, финревью батча 2)`

### Finding 1 (Important): пин задокументированного frontend-стека

**Finding:** план пинит «React 18, Vite, react-router 6», scaffold поставил react ^19.3.0 / react-dom ^19.3.0 / react-router-dom ^7.18.4 (дефект плана: unpinned `pnpm add`). Ruling: вернуть реализацию к плану, план/дизайн-доки не трогать.

**What changed:**
- `apps/web/package.json`: `react` ^18.3.1, `react-dom` ^18.3.1, `react-router-dom` ^6.30.6 (deps); `@types/react` ^18.3.31, `@types/react-dom` ^18.3.7 (devDeps). Vite остался 8 (план версию Vite не пинит — не дрейф).
- `pnpm-lock.yaml`: пересчитан под downgrade (+103/−51; apps/web-импортер и peer-суффиксы prisma-подграфа).
- `pnpm-workspace.yaml` (+6): `peerDependencyRules.allowedVersions: { '@types/react': '19' }` — см. surprise ниже.
- Код не менялся: stub `App.tsx` использует только createRoot/StrictMode/BrowserRouter/Routes/Route — идентичны между мажорами, как и ожидалось.

**Surprise (peer-dep конфликт на downgrade):** после `pnpm add react@^18 …` `pnpm peers check` показал unmet peer: `@types/react-dom@18.3.7` хочет `@types/react ^18`, а в peer-графе `@prisma/studio-core` (transitive prisma → studio GUI) остался авто-установленный `@types/react@19.3.0` — pnpm переиспользовал 18-инстанс `@types/react-dom` из apps/web внутрь 19-го peer-контекста radix-пакетов. Попытки вылечить in-place (`pnpm install --force`, `pnpm dedupe`, `--fix-lockfile`) stale-записи не снимали; полная регенерация lockfile (`rm pnpm-lock.yaml`) конфликт сняла, но дала неоправданный дрейф (nestjs 11.1→11.2, prisma 7.8→7.10) и НОВЫЙ unmet peer (`@nestjs/platform-fastify@11.2.5` хочет `@fastify/static ^10`, в репо ^9) — откачено (`git checkout HEAD -- pnpm-lock.yaml`). Итоговое решение: минимальный lockfile-дифф + явное разрешение пары через `peerDependencyRules.allowedVersions` в `pnpm-workspace.yaml` (в pnpm 11 поле `pnpm` в package.json больше не читается — перенесено; синтаксис плоский: `allowedVersions: { '<peer>': '<version>' }`). Конфликт типов-only, внутри prebuilt GUI-пакета, который в репо не запускается; в tsc нашего кода не входит. `pnpm peers check` → «No peer dependency issues found».

**Verification:** `pnpm --filter @mymozhem/web build` → `✓ built in 1.24s`; `typecheck` (tsc --noEmit) → чисто; `lint` (eslint src) → чисто.

### Finding 2 (Minor): порядок listRoster

**Finding:** `listRoster` без `orderBy` — порядок ростера не определён, перемешивается между refetch'ами.

**What changed:**
- `packages/core/src/membership/membership.service.ts`: `orderBy: { joinedAt: 'asc' }` в findMany (поле подтверждено: `schema.prisma:177`, `joinedAt DateTime @default(now())`), why-комментарий.
- `packages/core/src/membership/membership.service.int-spec.ts`: существующий тест использовал Map-lookup (order-insensitive), поэтому не ослаб, а УСИЛЕН — добавлен `expect(roster.map(r => r.identityId)).toEqual([ORG, alive, swept])`, пинящий порядок (организатор первым, далее по joinedAt).

**Verification:** `pnpm --filter @mymozhem/core test:int -- membership.service.int-spec` → `Tests: 40 passed, 40 total` (testcontainers, локальный Docker Postgres). Требовался `pnpm --filter @mymozhem/core run prisma:generate` после reinstall (postinstall-генерация клиента в репо отключена через allowBuilds — клиент был stale, `PrismaService` не видел делегаты).

### Finding 3 (Minor): depcruise-шов apps/web → apps/*

**Finding:** `apps/web/src` мог импортировать `../../server/src/…` (транзитивный путь в core) — ни одно правило не запрещало.

**What changed:**
- `.dependency-cruiser.cjs`: правило `web-no-cross-app-imports` (severity error) сразу после `web-only-through-sdk-and-app-packages`: `from ^apps/web/src`, `to ^apps/ pathNot ^apps/web/`.
- `scripts/verify-guardrails.mjs`: probe №8 — `apps/web/src/__probe-cross-app__.ts` с `import '../../server/src/main'`; expectFailure с output-сигналом `web-no-cross-app-imports`; cleanup в finally. Цель выбрана под `apps/server/src` (не `^packages/`) — импорт матчит ТОЛЬКО новое правило, маскировка соседним невозможна.

**Verification:**
1. `pnpm run boundary-check` → `✔ no dependency violations found (653 modules, 2015 dependencies cruised)` — правило не ловит легальные импорты.
2. `pnpm run guardrails` → exit 0, все 8 probes `OK`, включая `web → other apps/* import (dependency-cruiser)`, финал `All guardrails verified alive.`
3. **Вакуум-контроль нового probe:** ожидаемый сигнал временно подменён на `nonexistent-rule-name` → `FAIL — guardrail fired, но без ожидаемого сигнала "nonexistent-rule-name" on: web → other apps/* import (dependency-cruiser)` + баннер `Guardrails are NOT enforcing.`, exit 1. Revert → снова зелёный. Assertion вакуумно не проходит.

### Root gates

`pnpm run build` → 6/6 successful; `pnpm run typecheck` → 10/10 successful; `pnpm run lint` → 6/6 successful.

### Files changed (commit cf17671)

- `apps/web/package.json` — пин react 18 / react-dom 18 / react-router-dom 6 / @types ^18
- `pnpm-lock.yaml` — пересчёт под downgrade
- `pnpm-workspace.yaml` — peerDependencyRules.allowedVersions для @types/react 19 (studio-core)
- `packages/core/src/membership/membership.service.ts` — orderBy joinedAt asc
- `packages/core/src/membership/membership.service.int-spec.ts` — явный пин порядка ростера
- `.dependency-cruiser.cjs` — правило web-no-cross-app-imports
- `scripts/verify-guardrails.mjs` — probe №8 с output-сигналом
