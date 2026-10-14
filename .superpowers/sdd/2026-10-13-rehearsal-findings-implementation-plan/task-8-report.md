# Task 8 report — LAN playwright-smoke (A2) + чеклист первого события

**Commit:** `9d2ad1643b9ff9e41041ef4e4fe847b59b249c63` (branch rehearsal-fixes)
**Сообщение коммита:** `feat(web): LAN playwright-smoke с fail-closed валидацией baseURL + чеклист bare-run стенда (находка №7, дизайн §8.2)` + Co-Authored-By.

## Что сделано

- `apps/web/e2e/lan-base-url.vitest.spec.ts` — создан verbatim по брифу (14 кейсов: 6 разрешённых, 7 отказов, отсутствующая переменная).
- `apps/web/e2e/lan-base-url.ts` — создан verbatim по брифу (`assertLanBaseUrl`, fail-closed: только localhost/RFC1918 по plain http, возвращает origin).
- `apps/web/vite.config.ts` — `test.include` → `['src/**/*.spec.ts', 'e2e/**/*.vitest.spec.ts']` + комментарий о суффиксе.
- `apps/web/e2e/playwright.config.ts` — добавлен `testMatch: 'smoke.spec.ts'` (пин «сьют = один файл»).
- `apps/web/e2e/playwright.config.lan.ts` — создан verbatim по брифу (таймауты/сьют идентичны базовому; baseURL из `LAN_BASE_URL` через `assertLanBaseUrl`).
- `apps/web/package.json` — добавлен script `"test:e2e:lan": "playwright test --config e2e/playwright.config.lan.ts"`.
- `docs/sessions/2026-09-23-ui-slice-smoke-checklist.md` — новый блок `### 0.4.` между §0.3 и `## 1.` (verbatim по брифу); строка `| 0.4 | … | ⬜ | … |` добавлена в конец таблицы «Протокол прогона».

## TDD-последовательность

**Step 1 (красный, ожидаемый):**
```
$ pnpm --filter @mymozhem/web exec vitest run e2e/lan-base-url.vitest.spec.ts
No test files found, exiting with code 0
filter: e2e/lan-base-url.vitest.spec.ts
include: src/**/*.spec.ts
```
Как запроектировано: модуль отсутствует И include не покрывает e2e; `passWithNoTests` делает exit 0, но тест не исполнялся — «файлов не найдено». Не «чинилось».

**Step 2–3 (зелёный):**
```
$ pnpm --filter @mymozhem/web exec vitest run e2e/lan-base-url.vitest.spec.ts
 Test Files  1 passed (1)
      Tests  14 passed (14)
```

## Step 4 — эмпирическая fail-closed проверка (--list, стенд НЕ поднимался)

**Невалидный адрес:**
```
$ cd apps/web && LAN_BASE_URL=https://evil.example.com npx playwright test --config e2e/playwright.config.lan.ts --list
Error: LAN_BASE_URL: разрешён только plain http LAN-стенда, получено https://
    at assertLanBaseUrl (.../e2e/lan-base-url.ts:15:11)
    at .../e2e/playwright.config.lan.ts:16:14
```
Конфиг упал до загрузки тестов — отказ fail-closed. Маркер — «plain http» (проверка протокола стреляет раньше RFC1918-проверки; https-кейс запинан юнит-спекой именно с этим маркером). См. «Отклонения».

**Валидный адрес:**
```
$ LAN_BASE_URL=http://192.168.0.186:3000 ORGANIZER_SETUP_TOKEN=dummy-token-for-list-only npx playwright test --config e2e/playwright.config.lan.ts --list
Listing tests:
  [chromium] › smoke.spec.ts:15:1 › smoke: host → play → screen против compose-стенда
Total: 1 test in 1 file
```
Тесты НЕ запускались (`--list`), стенд не поднимался. `ORGANIZER_SETUP_TOKEN` нужен самим smoke.spec.ts уже при сборе (top-level throw) — dummy-значение только для листинга, см. «Отклонения».

**Санити базового конфига после testMatch-пина:**
```
$ ORGANIZER_SETUP_TOKEN=dummy-token-for-list-only npx playwright test --config e2e/playwright.config.ts --list
Listing tests:
  [chromium] › smoke.spec.ts:15:1 › smoke: host → play → screen против compose-стенда
Total: 1 test in 1 file
```

## Гейты (зелёные)

```
$ pnpm --filter @mymozhem/web lint      → eslint src: чисто
$ pnpm --filter @mymozhem/web typecheck → tsc --noEmit: чисто
$ pnpm --filter @mymozhem/web test      → Test Files 18 passed (18), Tests 111 passed (111)
```
Было 17 файлов/97 тестов → стало 18/111 (ровно +новая спека с 14 кейсами). e2e/*.ts вне typecheck — известный deferred T16 (бриф I-5); lan-конфиг верифицирован эмпирически выше.

## Отклонения от буквы брифа (с обоснованием)

1. **Сообщение об отказе при `https://evil.example.com` — «разрешён только plain http», а не «не localhost/RFC1918».** Проверка протокола стоит раньше проверки хоста (порядок verbatim из кода брифа), и юнит-спека брифа пинит https-кейс маркером `'plain http'`. Отказ fail-closed состоялся; формулировка ожидания в брифе («конфиг падает с "не localhost/RFC1918"») описывала эффект, а не точный маркер для https-входа.
2. **`--list` с валидным LAN_BASE_URL потребовал также dummy `ORGANIZER_SETUP_TOKEN`:** smoke.spec.ts бросает на top-level при сборе, если токен отсутствует (существующее поведение сьюта, не предмет задачи). Токен — заглушка только для листинга; стенд и сами тесты не запускались.
3. Добавлена санити-проверка `--list` базового конфига (не требовалась брифом) — подтверждение, что testMatch-пин не сломал существующий сьют.

Новых зависимостей не добавлено. Файлы коммита — ровно список брифа (7 файлов).
