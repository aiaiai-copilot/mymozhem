import { expect, test } from '@playwright/test';

// Setup-токен стенда (ADR-012 §2): вход организатора идёт через UI той же
// креденшалой, что задана стенду в ORGANIZER_SETUP_TOKEN (compose-директива :? —
// без неё стенд не стартует). Прогон обязан передать то же значение явно;
// без него smoke падает сразу, а не таймаутом на первом шаге.
const SETUP_TOKEN = process.env.ORGANIZER_SETUP_TOKEN;
if (!SETUP_TOKEN) {
  throw new Error('ORGANIZER_SETUP_TOKEN is required for smoke (same value as the compose stand)');
}

// Длинный вопрос второго раунда (Review Focus 5): 200+ символов — на проекторе
// обязан помещаться целиком (компактная плотность, мокап projector-options-no-lines).
const LONG_QUESTION =
  'Известно, что первое письменное упоминание о Рыбной слободе — будущем Рыбинске — ' +
  'встречается в летописных источниках XII века, а городской статус поселение получило ' +
  'значительно позже. Назовите год, который чаще всего называют датой первого ' +
  'упоминания поселения на этом месте.';

// Единый smoke UI-среза (Task 16, переписан под дизайн-срез T13): организатор
// ведёт квиз из двух вопросов, участник отвечает верно и видит reveal-вердикт,
// экран показывает вопросы; попутно — таймер (m:ss), reload без сброса таймера,
// live-ростер консоли, ландшафтный вьюпорт консоли, финал без розыгрыша,
// self-hosted шрифты и a11y-роли дорожек. Browser-context'ы в одном test —
// общий код комнаты и строгая последовательность шагов.
test('smoke: host → play → screen против compose-стенда', async ({ browser }) => {
  // Шаг 1. Организатор: лендинг → «Войти по токену организатора» → /host/login
  // → setup-токен → bootstrap (refresh-куку ставит сервер) → гейт → setup.
  const host = await (await browser.newContext()).newPage();
  // Верификация self-hosted шрифтов (T13, carry рендер-проверки subset'ов):
  // собираем все обращения страницы — среди хостов не должно быть Google Fonts.
  const hostRequestUrls: string[] = [];
  host.on('request', (req) => hostRequestUrls.push(req.url()));
  await host.goto('/');
  await host.getByRole('link', { name: 'Войти по токену организатора' }).click();
  await host.waitForURL('**/host/login');
  await host.getByLabel('Токен организатора').fill(SETUP_TOKEN);
  await host.getByRole('button', { name: 'Войти' }).click();
  // Гейт: молчаливый refresh по свежей куке → REGISTERED → setup (комнаты ещё нет).
  await host.waitForURL('**/host/new');
  await expect(host.getByRole('heading', { name: 'Настройка комнаты' })).toBeVisible();

  // Редактор квиза: два вопроса. Первый — короткий, correctIndex=0 — дефолт
  // формы (первое радио «Правильный» отмечено), значит «Париж» — верный ответ.
  // Поля адресуем внутри карточки вопроса (.editor-q-card): после второго
  // вопроса подписи/placeholder'ы в форме не уникальны.
  const q1 = host.locator('.editor-q-card').nth(0);
  await q1.getByLabel('Текст вопроса').fill('Столица Франции?');
  await q1.getByPlaceholder('Вариант 1').fill('Париж');
  await q1.getByPlaceholder('Вариант 2').fill('Лион');
  await host.getByRole('button', { name: '+ Добавить вопрос' }).click();
  // Второй — длинный (200+ символов, 3 варианта): проверка Review Focus 5 ниже.
  const q2 = host.locator('.editor-q-card').nth(1);
  await q2.getByLabel('Текст вопроса').fill(LONG_QUESTION);
  await q2.getByPlaceholder('Вариант 1').fill('1137');
  await q2.getByPlaceholder('Вариант 2').fill('1777');
  await q2.getByRole('button', { name: '+ Добавить вариант' }).click();
  await q2.getByPlaceholder('Вариант 3').fill('1676');
  await host.getByRole('button', { name: 'Сохранить и запустить' }).click();
  await host.waitForURL('**/host/console');
  // Якорь консоли (T13): h1 «Консоль ведущего» в разметке нет — полоса комнаты
  // (console-strip) с голым кодом (.console-room-code, без <strong>).
  await expect(host.locator('.console-strip')).toBeVisible();
  const roomCode = (await host.locator('.console-room-code').innerText()).trim();
  expect(roomCode.length).toBeGreaterThanOrEqual(6);

  // Шаг 2. Участник: новый context → /play/<code> → join → лобби активной игры
  // (комната уже ACTIVE — setup завершился activate до консоли). Написание
  // заголовка — дореформенное «Входъ» (Приложение A дизайна), сохранить.
  const player = await (await browser.newContext()).newPage();
  await player.goto(`/play/${roomCode}`);
  await expect(player.getByRole('heading', { name: 'Входъ в игру' })).toBeVisible();
  await player.getByLabel('Ваше имя (необязательно)').fill('Маша');
  await player.getByRole('button', { name: 'Играть' }).click();
  await expect(player.getByText('Игра идёт. Ждём вопрос…')).toBeVisible();

  // Шаг 3. Экран: третий context → spectator-join по коду из URL.
  const screen = await (await browser.newContext()).newPage();
  await screen.goto(`/screen/${roomCode}`);
  await expect(screen.getByText('Игра идёт. Ждём вопрос…')).toBeVisible();

  // Шаг 4. Организатор открывает вопрос 1: у участника — варианты и таймер,
  // на экране — вопрос крупно (h1.screen-question — проекторная раскладка
  // дизайна §4) и таймер золотом. Таймер — формат m:ss (T7/T8).
  await host.getByRole('button', { name: 'Открыть вопрос 1' }).click();
  await expect(screen.locator('h1.screen-question')).toHaveText('Столица Франции?');
  await expect(player.locator('.play-timer')).toHaveText(/^\d+:\d{2}$/);
  await expect(screen.locator('.screen-timer')).toContainText(/\d+:\d{2}/);
  // Кнопки вариантов несут буквенную метку (<b>А</b>…, мокап component-states-live),
  // поэтому доступное имя — «АПариж», а не «Париж»: адресуем по тексту.
  const correctOption = player.locator('.play-options button').filter({ hasText: 'Париж' });
  await expect(correctOption).toBeVisible();
  await expect(player.locator('.play-options button').filter({ hasText: 'Лион' })).toBeVisible();

  // Шаг 4а. Ландшафтный вьюпорт консоли (телефон ведущего горизонтально,
  // мокап console-phone-landscape-v2): главная кнопка момента видна без скролла.
  await host.setViewportSize({ width: 700, height: 360 });
  await expect(host.getByRole('button', { name: 'Закрыть вопрос' })).toBeInViewport();

  // Шаг 4б. Reload участника mid-question (Review Focus 1): гость перезаходит
  // автоматически, таймер НЕ сбрасывается на полный — отсчёт идёт от серверного
  // openedAt. Ждём ~2.5 с после открытия, перезагружаем, ждём таймер и
  // требуем строго меньше 30 сек (0:00–0:28; auto-wait переживает транзиенты
  // «Входим…» и возможные 0:29/0:30 первого кадра).
  await player.waitForTimeout(2500);
  await player.reload();
  await expect(player.locator('.play-timer')).toHaveText(/^0:(0\d|1\d|2[0-8])$/);

  // Шаг 5. Участник отвечает верно → мгновенный ack «Ответ принят.».
  await correctOption.click();
  await expect(player.getByText('Ответ принят.')).toBeVisible();

  // Шаг 5а. Второй участник заходит в живую комнату: консоль видит его имя
  // БЕЗ перезагрузки — core.member.joined → событийный рефетч ростера
  // (дедуп-окно 2 с пережидает auto-wait expect'а).
  const player2 = await (await browser.newContext()).newPage();
  await player2.goto(`/play/${roomCode}`);
  await player2.getByLabel('Ваше имя (необязательно)').fill('Петя');
  await player2.getByRole('button', { name: 'Играть' }).click();
  await expect(host.getByText('Петя (игрок)')).toBeVisible();

  // Шаг 6. Организатор закрывает вопрос → reveal: вердикт участника «Верно!»
  // (обязательный ассерт финревью батча 4 — класс дефекта «ловится только
  // живым прогоном»), очки из payload revealed, табло дорожками с a11y-ролями
  // (T13: list/listitem, у listitem нет name-from-content — фильтр по тексту);
  // у ответившего полоса .tr-lane .fill ненулевой ширины; экран показывает
  // «Правильный отвѣтъ» плашкой. Баллы детерминированы: единственный верный
  // ответ → base=100.
  await host.getByRole('button', { name: 'Закрыть вопрос' }).click();
  await expect(player.getByRole('heading', { name: 'Верно!' })).toBeVisible();
  await expect(player.getByText('+100 очков')).toBeVisible();
  await expect(player.getByRole('list').filter({ hasText: 'Маша' })).toBeVisible();
  await expect(player.getByRole('listitem').filter({ hasText: 'Маша' })).toBeVisible();
  // Полоса ответившего ненулевой ширины: fill — это «total минус прирост»
  // (trackWidths), поэтому после первого же верного ответа вся полоса — gain;
  // сумма сегментов > 0 — инвариант «дорожка ответившего видна».
  const mashaLane = player
    .getByRole('listitem')
    .filter({ hasText: 'Маша' })
    .locator('.tr-lane');
  const fillW = (await mashaLane.locator('.fill').boundingBox())?.width ?? 0;
  const gainW = (await mashaLane.locator('.gain').boundingBox())?.width ?? 0;
  expect(fillW + gainW, 'дорожка ответившего должна быть ненулевой ширины').toBeGreaterThan(0);
  await expect(screen.getByText('Правильный отвѣтъ')).toBeVisible();
  await expect(screen.locator('.screen-answer-value')).toHaveText('Париж');

  // Шаг 6а. Второй вопрос — длинный: на проекторе виден целиком, без клиппинга
  // (Review Focus 5): весь h1 во вьюпорте и без скрытого переполнения.
  await host.getByRole('button', { name: 'Открыть вопрос 2' }).click();
  const longH1 = screen.locator('h1.screen-question');
  await expect(longH1).toHaveText(LONG_QUESTION);
  await expect(longH1).toBeInViewport({ ratio: 1 });
  const clipped = await longH1.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(clipped, 'длинный вопрос не должен клиппиться на проекторе').toBe(false);

  // Шаг 6б. Закрываем второй вопрос без ответов: вердикт участника —
  // «Вы не успели ответить.», очки не меняются.
  await host.getByRole('button', { name: 'Закрыть вопрос' }).click();
  await expect(player.getByRole('heading', { name: 'Вы не успели ответить.' })).toBeVisible();

  // Шаг 7. Финал квиза (колода вычерпана — главная кнопка «Завершить квиз»):
  // confirm() принимаем dialog-handler'ом (Playwright по умолчанию диалоги
  // отклоняет — без handler'а команда не ушла бы). Розыгрыша не было → блок
  // победителей на проекторе отсутствует вовсе (п. 18 дизайна).
  host.once('dialog', (dialog) => void dialog.accept());
  await host.getByRole('button', { name: 'Завершить квиз' }).click();
  await expect(player.getByRole('heading', { name: 'Игра завершена' })).toBeVisible();
  await expect(player.getByText('Ваши очки: 100')).toBeVisible();
  await expect(screen.getByRole('heading', { name: 'Игра завершена' })).toBeVisible();
  await expect(screen.locator('.screen-winners')).toHaveCount(0);

  // Шаг 8. Self-hosted шрифты (T13): ни одного обращения к Google Fonts за всю
  // сессию страницы; семейства реально загружены (font-display: swap — ждём
  // document.fonts.ready перед check).
  expect(
    hostRequestUrls.filter((url) => /fonts\.(googleapis|gstatic)\.com/.test(url)),
    'обращений к Google Fonts быть не должно (woff2 self-hosted)',
  ).toEqual([]);
  const fontsLoaded = await host.evaluate(async () => {
    await document.fonts.ready;
    return [document.fonts.check('16px Oranienbaum'), document.fonts.check('16px "PT Sans"')];
  });
  expect(fontsLoaded).toEqual([true, true]);
});
