import { ApiClient } from '../../api/api-client';
import { refreshSession } from '../../api/endpoints';
import { SessionStore } from '../../state/session';

// anonClient (тот же паттерн, что в play-page): refresh — auth:false,
// access-токена ему не нужен, провайдер всегда отдаёт null.
const anonClient = new ApiClient({
  getAccessToken: () => null,
  refresh: () => Promise.resolve(),
});

// Один SessionStore на host-флоу: gate ставит access-токен после OAuth-refresh,
// setup/console расходуют его авторизованными вызовами. Страницы /host/* сменяются
// router-навигацией без перезагрузки, поэтому module-level экземпляр — способ
// разделить токен между ними; это состояние области /host в браузере, а не
// процессное состояние (REQ-CORE-004 — про сервер).
export const hostSession = new SessionStore(
  async () => (await refreshSession(anonClient)).accessToken,
);

// Авторизованный клиент host-области: 401 → silent refresh той же кукой → один
// retry (контракт ApiClient).
export const hostClient = new ApiClient(hostSession);
