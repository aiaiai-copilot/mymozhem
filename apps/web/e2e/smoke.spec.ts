import { expect, test } from '@playwright/test';

// Setup-токен стенда (ADR-012 §2): вход организатора идёт через UI той же
// креденшалой, что задана стенду в ORGANIZER_SETUP_TOKEN (compose-директива :? —
// без неё стенд не стартует). Прогон обязан передать то же значение явно;
// без него smoke падает сразу, а не таймаутом на первом шаге.
const SETUP_TOKEN = process.env.ORGANIZER_SETUP_TOKEN;
if (!SETUP_TOKEN) {
  throw new Error('ORGANIZER_SETUP_TOKEN is required for smoke (same value as the compose stand)');
}

// Единый smoke UI-среза (Task 16): организатор ведёт квиз, участник отвечает
// верно и видит reveal-вердикт, экран показывает вопрос. Три browser-context'а
// в одном test — общий код комнаты и строгая последовательность шагов.
test('smoke: host → play → screen против compose-стенда', async ({ browser }) => {
  // Шаг 1. Организатор: лендинг → «Войти по токену организатора» → /host/login
  // → setup-токен → bootstrap (refresh-куку ставит сервер) → гейт → setup.
  const host = await (await browser.newContext()).newPage();
  await host.goto('/');
  await host.getByRole('link', { name: 'Войти по токену организатора' }).click();
  await host.waitForURL('**/host/login');
  await host.getByLabel('Токен организатора').fill(SETUP_TOKEN);
  await host.getByRole('button', { name: 'Войти' }).click();
  // Гейт: молчаливый refresh по свежей куке → REGISTERED → setup (комнаты ещё нет).
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
  await player.getByLabel('Ваше имя (необязательно)').fill('Маша');
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
