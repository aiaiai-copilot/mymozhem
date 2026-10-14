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
