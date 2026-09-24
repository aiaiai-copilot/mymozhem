import { defineConfig } from '@playwright/test';

// Smoke-контур UI-среза (Task 16). Цель — ТОЛЬКО локальный docker-compose
// стенд: server same-origin отдаёт и API, и собранный SPA (WEB_STATIC_DIR).
// baseURL намеренно зашит в конфиг и не читается из env: e2e не должен
// получить возможность указать на production даже случайно.
export default defineConfig({
  // Один сьют, последовательные шаги тремя browser-context'ами в одном test —
  // параллелизм и шардирование бессмысленны и вредны (общий код комнаты).
  workers: 1,
  // Один retry против транзиентов сети/docker; детерминированный дефект
  // retry не маскирует — ассерты строгие.
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
