import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dev-proxy: браузер видит same-origin (дизайн §2) — CORS не нужен ни в dev, ни в проде.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/rooms': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // До батчей C/D спек нет, а turbo-гейт `test` обязан оставаться зелёным
    // (REQ-DEV-001): пустой пакет — не падение.
    passWithNoTests: true,
  },
});
