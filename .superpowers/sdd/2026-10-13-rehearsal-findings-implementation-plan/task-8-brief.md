### Task 8: LAN playwright-smoke (A2) + чеклист первого события (№7 регламент)

**Закрывает:** REQ-DEV-001-контур (процедурный); дизайн §3 + §8.2.

**Files:**
- Create: `apps/web/e2e/lan-base-url.ts`
- Test: `apps/web/e2e/lan-base-url.vitest.spec.ts`
- Create: `apps/web/e2e/playwright.config.lan.ts`
- Modify: `apps/web/e2e/playwright.config.ts` (`testMatch`)
- Modify: `apps/web/vite.config.ts` (vitest include)
- Modify: `apps/web/package.json` (script test:e2e:lan)
- Modify: `docs/sessions/2026-09-23-ui-slice-smoke-checklist.md` (блок §0.4 + строки протокола)

**Interfaces:**
- Consumes: существующий smoke.spec.ts (не меняется).
- Produces: `assertLanBaseUrl(raw: string | undefined): string`; команда `pnpm --filter @mymozhem/web test:e2e:lan` (требует env LAN_BASE_URL).

**Почему суффикс `.vitest.spec.ts`:** playwright по умолчанию подхватывает `*.spec.ts` из testDir, vitest include — `src/**`; пересечение устраняем двумя ходами: оба playwright-конфига получают явный `testMatch: 'smoke.spec.ts'` (заодно пин «сьют = один файл»), vitest include += `'e2e/**/*.vitest.spec.ts'`.

- [ ] **Step 1: Падающий тест валидации**

Создать `apps/web/e2e/lan-base-url.vitest.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertLanBaseUrl } from './lan-base-url';

// Fail-closed валидация LAN_BASE_URL (дизайн §8.2): только localhost/RFC1918 по
// plain http. Прогон e2e по внешнему адресу запрещён конфигурационно — интент
// «никогда не production» базового playwright.config.ts здесь машинный.
describe('assertLanBaseUrl', () => {
  it.each([
    ['http://192.168.0.186:3000', 'http://192.168.0.186:3000'],
    ['http://10.0.0.5:3000', 'http://10.0.0.5:3000'],
    ['http://172.16.1.1:3000', 'http://172.16.1.1:3000'],
    ['http://172.31.255.254:3000', 'http://172.31.255.254:3000'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000'], // origin без trailing slash
  ])('разрешён: %s', (input, expected) => {
    expect(assertLanBaseUrl(input)).toBe(expected);
  });

  it.each([
    ['https://192.168.0.186:3000', 'plain http'], // TLS на LAN-стенде нет
    ['http://8.8.8.8:3000', 'RFC1918'], // публичный IP
    ['http://172.15.0.1:3000', 'RFC1918'], // вне диапазона 172.16–31
    ['http://172.32.0.1:3000', 'RFC1918'],
    ['http://192.167.0.1:3000', 'RFC1918'],
    ['http://mymozhem.example.com', 'RFC1918'], // домен, не IP
    ['not-a-url', 'URL'],
  ])('отказ: %s', (input, marker) => {
    expect(() => assertLanBaseUrl(input)).toThrow(marker);
  });

  it('отсутствующая переменная — отказ с подсказкой формата', () => {
    expect(() => assertLanBaseUrl(undefined)).toThrow('LAN_BASE_URL обязателен');
  });
});
```

Run: `pnpm --filter @mymozhem/web exec vitest run e2e/lan-base-url.vitest.spec.ts`
Expected: FAIL (модуль не существует И vitest include не покрывает e2e — сначала шаг 3).

- [ ] **Step 2: Реализация lan-base-url.ts**

Создать `apps/web/e2e/lan-base-url.ts`:

```ts
// Fail-closed валидация LAN_BASE_URL (дизайн §8.2): только localhost или
// RFC1918-адрес по plain http. Любой другой хост/схема (включая публичный прод)
// — отказ ДО старта тестов. Возвращает origin (без пути/trailing slash).
export function assertLanBaseUrl(raw: string | undefined): string {
  if (!raw) {
    throw new Error('LAN_BASE_URL обязателен (например http://192.168.0.186:3000)');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`LAN_BASE_URL не является URL: ${raw}`);
  }
  if (url.protocol !== 'http:') {
    throw new Error(`LAN_BASE_URL: разрешён только plain http LAN-стенда, получено ${url.protocol}//`);
  }
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return url.origin;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  const isPrivate =
    m !== null &&
    (Number(m[1]) === 10 ||
      (Number(m[1]) === 172 && Number(m[2]) >= 16 && Number(m[2]) <= 31) ||
      (Number(m[1]) === 192 && Number(m[2]) === 168));
  if (!isPrivate) {
    throw new Error(
      `LAN_BASE_URL: хост ${host} не localhost/RFC1918 — прогон e2e по внешнему адресу запрещён`,
    );
  }
  return url.origin;
}
```

- [ ] **Step 3: vitest include + playwright testMatch**

`vite.config.ts` — test.include:

```ts
    include: ['src/**/*.spec.ts', 'e2e/**/*.vitest.spec.ts'],
```

(комментарий: суффикс .vitest.spec.ts — e2e-спеки, которые playwright НЕ подхватывает: у обоих playwright-конфигов явный testMatch).

`e2e/playwright.config.ts` — добавить в defineConfig:

```ts
  testMatch: 'smoke.spec.ts',
```

Run: `pnpm --filter @mymozhem/web exec vitest run e2e/lan-base-url.vitest.spec.ts`
Expected: PASS.

- [ ] **Step 4: LAN-конфиг playwright + script**

Создать `apps/web/e2e/playwright.config.lan.ts`:

```ts
import { defineConfig } from '@playwright/test';
import { assertLanBaseUrl } from './lan-base-url';

// LAN-вариант smoke (дизайн 2026-10-13 §8.2, находки репетиции): прогон против
// стенда по IP машины — ловит класс «браузер × топология», невидимый с localhost
// (CSP, Secure-кука, NAT). Сьют/таймауты идентичны базовому конфигу; baseURL —
// из LAN_BASE_URL с fail-closed валидацией (только localhost/RFC1918 по http).
export default defineConfig({
  workers: 1,
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  testMatch: 'smoke.spec.ts',
  use: {
    baseURL: assertLanBaseUrl(process.env.LAN_BASE_URL),
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
```

`apps/web/package.json` scripts += :

```json
    "test:e2e:lan": "playwright test --config e2e/playwright.config.lan.ts",
```

Проверка fail-closed (не прогон тестов, а отказ конфига):
Run: `cd apps/web && LAN_BASE_URL=https://evil.example.com npx playwright test --config e2e/playwright.config.lan.ts --list`
Expected: конфиг падает с «не localhost/RFC1918».
Run: `LAN_BASE_URL=http://192.168.0.186:3000 npx playwright test --config e2e/playwright.config.lan.ts --list`
Expected: список из smoke.spec.ts (тесты НЕ запускаются — стенд в этой задаче не поднимаем).

- [ ] **Step 5: Чеклист первого события**

В `docs/sessions/2026-09-23-ui-slice-smoke-checklist.md`:

1. Новый блок после §0.3:

```markdown
### 0.4. Стенд на событие — bare-run сервера (находка №7)

docker NAT скрывает реальные IP клиентов (exclusion по IP банит всех, rate-limit
общий — воспроизведено на репетиции 2026-10-13). На событие сервер запускается
НА ХОСТЕ, в контейнере остаётся только БД:

1. `docker compose up postgres` (только БД).
2. `pnpm build` из корня.
3. Сервер на хосте: `DATABASE_URL=postgresql://mymozhem:mymozhem@localhost:5432/mymozhem JWT_SECRET=... ORGANIZER_SETUP_TOKEN=... PRIZE_MODE=off COOKIE_SECURE=false pnpm --filter @mymozhem/server start`.
   ВНИМАНИЕ: compose по умолчанию НЕ публикует порт 5432 на хост — для bare-run
   добавить в docker-compose.override.yml или пробросить порт одноразово
   (`docker compose run`-стиль не подходит; см. комментарий в docker-compose.yml).
4. Web отдаётся тем же сервером (WEB_STATIC_DIR) — один origin на LAN-IP хоста.
5. COOKIE_SECURE=false — ТОЛЬКИ для plain-HTTP LAN (находка №2): иначе телефоны
   не примут refresh-куку и сессия будет с 15-минутным потолком.
6. Контрольная строка: участник с телефона исключается → ROOM_JOIN_DENIED
   получает ТОЛЬКО он, остальные продолжают. Вторая контрольная: вход 5+
   устройств подряд без 429.
7. Перед гостями: LAN-smoke — `LAN_BASE_URL=http://<IP-хоста>:3000 pnpm --filter @mymozhem/web test:e2e:lan`.
```

2. В таблицу «Протокол прогона» добавить строки (статус «⬜ не прогнано»):

```markdown
| 0.4 | стенд на событие: bare-run + COOKIE_SECURE=false + LAN-smoke | ⬜ | Добавлено 2026-10-13 (сессия 38, пакет фиксов репетиции); прогон — при подготовке первого события |
```

- [ ] **Step 6: Гейты + коммит**

Run: `pnpm --filter @mymozhem/web lint && pnpm --filter @mymozhem/web typecheck && pnpm --filter @mymozhem/web test`
Expected: зелёные (typecheck не покрывает e2e/*.ts — известный deferred T16; lan-конфиг проверен шагом 4 эмпирически).

```bash
git add apps/web/e2e/lan-base-url.ts apps/web/e2e/lan-base-url.vitest.spec.ts apps/web/e2e/playwright.config.lan.ts apps/web/e2e/playwright.config.ts apps/web/vite.config.ts apps/web/package.json docs/sessions/2026-09-23-ui-slice-smoke-checklist.md
git commit -m "feat(web): LAN playwright-smoke с fail-closed валидацией baseURL + чеклист bare-run стенда (находка №7, дизайн §8.2)"
```

---

## Финальная приёмка пакета (после батча C, в той же сессии батча C или отдельной по правилу владельца)

1. **Двухстадийное ревью** (superpowers:requesting-code-review): стадия 1 — spec-compliance по REQ-разметке каждой задачи (заголовки «Закрывает:» + §10 дизайна); стадия 2 — code-quality.
2. **Ручной прогон строк чеклиста** против LAN-стенда (compose с `COOKIE_SECURE=false` или bare-run): 7.1 (reload консоли — сессия жива), 11.1 (exclude бьёт ровно одного; стейл-ростер → alert «перезашёл»), 12.2 (reload участника; протухание → автоперезаход без перезагрузки). Статусы — в таблицу протокола.
3. **HANDOFF** обновить (находки закрыты, автоматика введена, открытые решения сняты).
4. Merge в `main` no-ff, push, удаление ветки — по установленному ритуалу репо.

## Self-review (интерпретации плана — для ревью владельцем)

- **I-1 (Task 2, шаг 2):** XFF-сьют зелёный сразу — это осознанно характеризационный страж: дефект №7 был топологией деплоя, а не серверной логикой. Красный кейс на шаге 2 = реальная находка → стоп и эскалация, а не «чинить под тест».
- **I-2 (Task 4, шаг 5):** `opts` сознательно НЕ в deps effect useRoomBinding — объект-литерал перезапускал бы effect на каждый рендер; потребители передают стабильные useCallback (Task 5 так и делает). Риск устаревшего замыкания accepted: onSessionDead читает setState-функции, стабильные по React.
- **I-3 (Task 5):** страницы остаются без DOM-тестов (нет @testing-library/react — deferred T10 батча 4 UI-среза); wiring верифицируется typecheck + ручной приёмкой строки 12.2. Тестируемые швы вынесены в чистые функции (rejoinAsGuest).
- **I-4 (Task 5, screen):** `joinStarted` → `joinInFlight` допускает dev-StrictMode двойной spectator-join в узком окне (первая попытка settled до второго mount); в проде effect одноразовый. Принято ради повторного входа по onSessionDead.
- **I-5 (Task 8):** e2e/*.ts вне typecheck (deferred T16) — lan-конфиг верифицируется эмпирически (`--list` с валидным/невалидным env), валидация логики запинана vitest.
- **I-6 (Task 1):** кейс `auto + test` не тестируется отдельно — NODE_ENV='test' покрыт кейсом development (оба не production); добавление четвёртой строки посчитано избыточным.
- **Review Focus 3 (Task 2, шаг 3):** выбор адреса из цепочки XFF — семантика fastify/proxy-addr; план пинит консистентность (ровно один из двух забанен), а фактический адрес дописывается в комментарий после первого прогона. Если владелец хочет жёсткий пин конкретного адреса — отдельное решение после эмпирики.
