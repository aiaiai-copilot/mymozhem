# Task 16 — Playwright smoke + CI: отчёт исполнителя

Дата: 2026-09-24. Ветка `ui-slice` (worktree `.worktrees/ui-slice`).

## Что реализовано

1. **Seed-скрипт** `apps/server/scripts/e2e-web-seed.mjs` — зеркало `create-room.mjs`
   (точечные subpath-импорты из `@mymozhem/core/dist/...`, не barrel): REGISTERED
   identity (reuse по частичному уникальному индексу `Identity_registered_email_key`)
   + живая сессия через `TokenService.issueRegisteredTokens`. stdout — JSON
   `{"refreshToken":"..."}`. Запуск внутри контейнера server (compose by design не
   публикует Postgres на хост): `docker compose exec -T server node apps/server/scripts/e2e-web-seed.mjs --email=e2e@example.com`.
2. **Smoke-сьют** `apps/web/e2e/smoke.spec.ts` + `apps/web/e2e/playwright.config.ts`
   (baseURL `http://localhost:3000` зашит, workers 1, retries 1, chromium). Один test,
   три browser-context'а, последовательные шаги:
   - Шаг 0 — OAuth-шов (требование финревью батча 5): `GET /auth/google?redirect=<encodeURIComponent('http://localhost:3000/host')>`
     → **302**, `Location` на `https://accounts.google.com/` (maxRedirects: 0, за Google
     не ходим); на лендинге ссылка «Войти через Google» несёт ровно этот absolute URL.
   - Организатор: `context.addCookies` (`mm_refresh`, path `/auth` — зеркало
     `refresh-cookie.ts`) → `/host` → гейт → `/host/new` → редактор (1 вопрос
     «Столица Франции?», варианты «Париж»/«Лион», correctIndex=0 — дефолт формы) →
     «Сохранить и запустить» → `/host/console`, код комнаты читается из `.room-code strong`.
   - Участник: новый context → `/play/<code>` → join («Маша») → лобби активной игры
     «Игра идёт. Ждём вопрос…» → после open варианты → ответ «Париж» → «Ответ принят.».
   - Экран: третий context → `/screen/<code>` → spectator-join → после open
     `h1.screen-question` с текстом вопроса.
   - Reveal-вердикт (требование финревью батча 4): после «Закрыть вопрос» участник
     видит heading «Верно!», «+100 очков» (детерминировано: единственный верный
     ответ → scoring base=100), строку «Маша» в табло; экран — «Правильный ответ: Париж».
   - Финал: «Завершить квиз» с `dialog`-handler'ом (Playwright по умолчанию отклоняет
     confirm()) → участник и экран видят «Игра завершена», участник — «Ваши очки: 100».
   - Токен организатора: env `E2E_REFRESH_TOKEN` (CI) или прямой `docker compose exec`
     seed из теста (локально; compose-CLI требует JWT_SECRET для интерполяции даже на
     exec — передаётся фиктивный, контейнер работает на своём env).
3. **docker-compose.yml**: добавлены `OAUTH_REDIRECT_ALLOWLIST` (дефолт
   `http://localhost:3000/host` — ровно то, что шлёт лендинг) и dummy-тройка Google
   OAuth (`GOOGLE_CLIENT_ID/SECRET`, `OAUTH_REDIRECT_URI`) — без неё `/auth/google`
   отвечал бы 503 `OAUTH_NOT_CONFIGURED` (all-or-none superRefine в config.schema),
   и 302-шов был бы непроверяем. Все значения переопределяемы из окружения; dummy
   не годятся для боевого callback (сети к Google на start нет).
4. **CI job `e2e-web`** в `.github/workflows/ci.yml` (после `build`): checkout →
   pnpm install → `docker compose up -d --build` (JWT_SECRET — фиктивный, job-level
   env, т.к. compose-CLI интерполирует его в up/exec/down) → ожидание `/health/live`
   (curl-цикл, при таймауте — `docker compose logs server`) →
   `playwright install --with-deps chromium` → seed-шаг (exec в контейнер, токен в
   `GITHUB_ENV`) → `pnpm --filter @mymozhem/web test:e2e` → `docker compose down -v`
   (always). YAML проверен парсером.
5. **apps/web/package.json**: скрипт `test:e2e` (`playwright test --config
   e2e/playwright.config.ts`), devDependency `@playwright/test` ^1.63.0 (один
   lockfile, через `pnpm add`).

## Тестовое доказательство (локальный стенд, проект compose `ui-slice`)

Стенд: `JWT_SECRET=<dummy> docker compose up -d --build` → postgres healthy, server up,
`curl /health/live` → `{"status":"ok"}`.

OAuth-зонд до теста:
```
curl -s -o /dev/null -w "%{http_code} %{redirect_url}" \
  "http://localhost:3000/auth/google?redirect=http%3A%2F%2Flocalhost%3A3000%2Fhost"
→ 302 https://accounts.google.com/o/oauth2/v2/auth?client_id=e2e-dummy-client-id&...
```

Seed:
```
docker compose exec -T server node apps/server/scripts/e2e-web-seed.mjs --email=e2e@example.com
→ {"refreshToken":"dLicdQVJYOg-R1uLvavZeH_fG73s_Eo50F6XfHchkn0"}
```

E2E-прогоны (каждый — полный флоу host/play/screen):
```
pnpm --filter @mymozhem/web test:e2e        → 1 passed (6.0s)   # первый, холодный
pnpm test:e2e × 3                           → 1 passed × 3 (1.4s каждый)  # детерминизм
E2E_REFRESH_TOKEN=<seed> pnpm test:e2e      → 1 passed (1.1s)   # путь CI
```

Полный конвейер (с `DOCKER_HOST=unix://~/.orbstack/run/docker.sock` — см. concerns):
```
pnpm run build          → 6 successful, 6 total
pnpm run typecheck      → 10 successful, 10 total
pnpm run lint           → 6 successful, 6 total
pnpm run test           → 10 successful, 10 total (web: 69/69 — без деградации)
pnpm run test:int       → 5 successful, 5 total
pnpm run boundary-check → no dependency violations (700 modules)
pnpm run guardrails     → all guardrails verified alive
```

## data-testid

Не добавлялись. Все селекторы — по фактическим role/text/class существующей
разметки: `getByRole('heading'|'button'|'link'|'cell', …)`, `getByLabel`,
`getByPlaceholder`, `getByText` с точными строками страниц; классы `.room-code
strong` и `h1.screen-question` — существующие (семантические, не тестовые).

## Self-review findings

- Хрупких `waitForTimeout` нет: ожидания — `waitForURL` и web-first assertions
  (Playwright click ждёт enabled — важно для «Открыть вопрос 1», который disabled,
  пока не пришёл snapshot с appSettings).
- Тексты сверены с исходниками страниц (play-page.tsx: «Верно!»/«Неверно.»/
  «Ответ принят.»/«Игра идёт. Ждём вопрос…»; quiz-controls: «Открыть вопрос 1»/
  «Закрыть вопрос»/«Завершить квиз») и подтверждены живыми прогонами.
- Кука сажается с `path: '/auth'` (зеркало серверного `setRefreshCookie`),
  `secure` не выставлен — стенд на http; refresh-шов упражняется по-настоящему
  (access-токен клиент получает только через POST /auth/refresh).
- Retry-повтор безопасен: seed идемпотентен по identity и создаёт новую сессию;
  организатор создаёт новую комнату (сервер не ограничивает число комнат), код
  перечитывается из консоли на каждом прогоне.
- e2e-файлы не попадают под `vitest` (include `src/**`), `eslint src`,
  `tsc -p tsconfig.json` (include `src`) и depcruise-правила `^apps/web/src` —
  границы не задеты (boundary-check чист, 700 модулей).
- Покрытие: все три флоу + OAuth-шаг + reveal-вердикт + финал квиза — в одном
  последовательном test, как мандатит бриф.

## Concerns

1. **e2e/*.ts не typecheck'ается**: web `tsconfig.json` включает только `src`
   (типизация spec опирается на исполнение Playwright в CI). Осознанно не
   расширял include — потянуло бы `@types/node` в браузерный tsconfig
   (`process`, `node:child_process`). Если захотим строгости — отдельный
   `tsconfig.e2e.json`; за рамками брифа.
2. **Локальный testcontainers**: `pnpm test`/`test:int` для apps/server и core
   на этой машине требуют `DOCKER_HOST=unix://~/.orbstack/run/docker.sock`
   (симлинк `/var/run/docker.sock` указывает на мёртвый сокет Docker Desktop,
   testcontainers не находит runtime). Не связано с задачей — предсуществующая
   особенность машины; в CI (ubuntu, docker нативный) не воспроизводится.
3. **CI seed-шаг через jq**: jq есть на ubuntu-latest из коробки; если
   provisioning изменится — шаг упадёт явно (`test -n "$TOKEN"`).
4. Локальный compose-стенд после работы погашен (`docker compose down`); том
   postgres НЕ удалён — при желании чистого состояния `docker compose down -v`.

---

## Fix-отчёт — раунд 1/5 (2026-09-24)

### Critical 1: `pnpm exec playwright` из корня workspace не находит бинарь

**Причина:** `@playwright/test` — devDependency только `apps/web`; в корневом
package.json его нет, hoisting не задан, поэтому `pnpm exec playwright ...` из
корня раннера падал бы с `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "playwright"
not found` — job e2e-web никогда не дошёл бы до тестов.

**Фикс:** `.github/workflows/ci.yml` — шаг установки браузеров переведён на
`pnpm --filter @mymozhem/web exec playwright install --with-deps chromium`
(с комментарием-причиной в YAML). Соседние шаги джобы проверены: запуск тестов
уже корректен (`pnpm --filter @mymozhem/web test:e2e` — скрипт исполняется с
cwd apps/web, где бинарь доступен); `pnpm install`, `docker compose …` из корня
от web-only бинарей не зависят.

**Проверка (локально, worktree):**

```
$ pnpm exec playwright --version        # из корня, прежняя форма
undefined
[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "playwright" not found

$ pnpm --filter @mymozhem/web exec playwright --version
Version 1.63.0
```

YAML проверен парсером (`yaml.safe_load` → OK). Полный e2e-прогон не гонялся:
diff только в CI-джобе, командная форма `--filter … test:e2e` доказана зелёными
прогонами из основного отчёта (5/5).

### Minor (принято к сведению, не в раунде)

1. e2e/*.ts вне typecheck — осознанно (см. Concerns основного отчёта).
2. `JSON.parse(stdout.trim())` в smoke.spec.ts — диагностируемость приемлема
   (при мусоре в stdout ошибка парсинга несёт сам stdout в message).
