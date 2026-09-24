import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';

const execFileAsync = promisify(execFile);

// Имя refresh-куки — константа REFRESH_COOKIE ядра
// (packages/core/src/auth/auth.constants.ts). Хардкод осознанный: e2e — это
// потребитель wire-контракта снаружи, импорт core из apps/web запрещён
// границей (ADR-002); если константу переименуют, smoke упадёт — и правильно.
const REFRESH_COOKIE = 'mm_refresh';
const BASE = 'http://localhost:3000';
// Лендинг шлёт ровно `${origin}/host` (landing.tsx); стенд обязан принять его
// OAUTH_REDIRECT_ALLOWLIST'ом (exact match, z.array(z.url()) — config.schema).
const HOST_REDIRECT = `${BASE}/host`;

// Refresh-токен организатора: из env (CI прогоняет seed отдельным шагом) или
// прямым вызовом seed-скрипта в контейнере (локальный прогон — compose не
// публикует Postgres на хост by design, поэтому seed бежит внутри server).
async function seedRefreshToken(): Promise<string> {
  const fromEnv = process.env.E2E_REFRESH_TOKEN;
  if (fromEnv) return fromEnv;
  const { stdout } = await execFileAsync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'server',
      'node',
      'apps/server/scripts/e2e-web-seed.mjs',
      '--email=e2e@example.com',
    ],
    {
      env: {
        ...process.env,
        // compose-CLI интерполирует окружение файла даже для exec (JWT_SECRET
        // в compose помечен :? — fail-closed, REQ-SEC-002). Это значение видит
        // только локальный интерполятор; контейнер работает на своём env.
        JWT_SECRET: 'e2e-seed-cli-interpolation-only-0123456789abcdef',
      },
    },
  );
  const parsed = JSON.parse(stdout.trim()) as { refreshToken?: unknown };
  if (typeof parsed.refreshToken !== 'string') {
    throw new Error(`e2e-web-seed не вернул refreshToken: ${stdout}`);
  }
  return parsed.refreshToken;
}

// Единый smoke UI-среза (Task 16): организатор ведёт квиз, участник отвечает
// верно и видит reveal-вердикт, экран показывает вопрос. Три browser-context'а
// в одном test — общий код комнаты и строгая последовательность шагов.
test('smoke: host → play → screen против compose-стенда', async ({ browser, request }) => {
  // Шаг 0. OAuth-шов env↔UI (требование финревью батча 5): без реальных
  // Google-кредов (compose несёт dummy-тройку) проверяем, что redirect лендинга
  // проходит allowlist и сервер отвечает 302 на accounts.google.com, а не 400
  // OAUTH_REDIRECT_INVALID. maxRedirects: 0 — за Google не ходим.
  const oauthStart = await request.get(
    `/auth/google?redirect=${encodeURIComponent(HOST_REDIRECT)}`,
    { maxRedirects: 0 },
  );
  expect(oauthStart.status()).toBe(302);
  expect(oauthStart.headers()['location']).toMatch(/^https:\/\/accounts\.google\.com\//);

  // Шаг 1. Организатор: seed-кука mm_refresh → /host → гейт → setup → консоль.
  const host = await (await browser.newContext()).newPage();
  // Лендинг — вторая половина шва: ссылка обязана нести тот самый absolute URL.
  await host.goto('/');
  await expect(host.getByRole('link', { name: 'Войти через Google' })).toHaveAttribute(
    'href',
    `/auth/google?redirect=${encodeURIComponent(HOST_REDIRECT)}`,
  );
  // Сервер ставит куку httpOnly, SameSite=Strict, Path=/auth (refresh-cookie.ts)
  // — зеркалим path: refresh-эндпоинт единственный её потребитель. secure не
  // ставим: стенд живёт на http://localhost.
  await host.context().addCookies([
    { name: REFRESH_COOKIE, value: await seedRefreshToken(), domain: 'localhost', path: '/auth' },
  ]);
  await host.goto('/host');
  // Гейт: молчаливый refresh по куке → REGISTERED → setup (комнаты ещё нет).
  await host.waitForURL('**/host/new');
  await expect(host.getByRole('heading', { name: 'Настройка комнаты' })).toBeVisible();

  // Редактор квиза: 1 вопрос, 2 варианта; correctIndex=0 — дефолт формы
  // (первое радио «Правильный» отмечено), значит «Париж» — верный ответ.
  await host.getByLabel('Текст вопроса').fill('Столица Франции?');
  await host.getByPlaceholder('Вариант 1').fill('Париж');
  await host.getByPlaceholder('Вариант 2').fill('Лион');
  await host.getByRole('button', { name: 'Сохранить и запустить' }).click();
  await host.waitForURL('**/host/console');
  await expect(host.getByRole('heading', { name: 'Консоль ведущего' })).toBeVisible();
  await expect(host.getByText('Код комнаты:')).toBeVisible();
  const roomCode = (await host.locator('.room-code strong').innerText()).trim();
  expect(roomCode.length).toBeGreaterThanOrEqual(6);

  // Шаг 2. Участник: новый context → /play/<code> → join → лобби активной игры
  // (комната уже ACTIVE — setup завершился activate до консоли).
  const player = await (await browser.newContext()).newPage();
  await player.goto(`/play/${roomCode}`);
  await expect(player.getByRole('heading', { name: 'Вход в игру' })).toBeVisible();
  await player.getByLabel('Ваше имя').fill('Маша');
  await player.getByRole('button', { name: 'Играть' }).click();
  await expect(player.getByText('Игра идёт. Ждём вопрос…')).toBeVisible();

  // Шаг 3. Экран: третий context → spectator-join по коду из URL.
  const screen = await (await browser.newContext()).newPage();
  await screen.goto(`/screen/${roomCode}`);
  await expect(screen.getByText('Игра идёт. Ждём вопрос…')).toBeVisible();

  // Шаг 4. Организатор открывает вопрос: у участника — варианты, на экране —
  // вопрос крупно (h1.screen-question — проекторная раскладка дизайна §4).
  await host.getByRole('button', { name: 'Открыть вопрос 1' }).click();
  await expect(screen.locator('h1.screen-question')).toHaveText('Столица Франции?');
  const correctOption = player.getByRole('button', { name: 'Париж', exact: true });
  await expect(correctOption).toBeVisible();
  await expect(player.getByRole('button', { name: 'Лион', exact: true })).toBeVisible();

  // Шаг 5. Участник отвечает верно → мгновенный ack «Ответ принят.».
  await correctOption.click();
  await expect(player.getByText('Ответ принят.')).toBeVisible();

  // Шаг 6. Организатор закрывает вопрос → reveal: вердикт участника «Верно!»
  // (обязательный ассерт финревью батча 4 — класс дефекта «ловится только
  // живым прогоном»), очки из payload revealed, табло с именем; экран показывает
  // правильный ответ. Баллы детерминированы: единственный верный ответ → base=100.
  await host.getByRole('button', { name: 'Закрыть вопрос' }).click();
  await expect(player.getByRole('heading', { name: 'Верно!' })).toBeVisible();
  await expect(player.getByText('+100 очков')).toBeVisible();
  await expect(player.getByRole('cell', { name: 'Маша' })).toBeVisible();
  await expect(screen.getByText('Правильный ответ: Париж')).toBeVisible();

  // Шаг 7. Финал квиза: confirm() принимаем dialog-handler'ом (Playwright по
  // умолчанию диалоги отклоняет — без handler'а команда не ушла бы).
  host.once('dialog', (dialog) => void dialog.accept());
  await host.getByRole('button', { name: 'Завершить квиз' }).click();
  await expect(player.getByRole('heading', { name: 'Игра завершена' })).toBeVisible();
  await expect(player.getByText('Ваши очки: 100')).toBeVisible();
  await expect(screen.getByRole('heading', { name: 'Игра завершена' })).toBeVisible();
});
