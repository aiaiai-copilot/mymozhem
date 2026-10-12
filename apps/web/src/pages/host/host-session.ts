import { ApiClient } from '../../api/api-client';
import { refreshSession } from '../../api/endpoints';
import { SessionStore } from '../../state/session';

// anonClient (тот же паттерн, что в play-page): refresh/bootstrap — auth:false,
// access-токена им не нужен, провайдер всегда отдаёт null. Экспортируется для
// host-login-page (ruling: консоль не плодит второй клиент/SessionStore).
export const anonClient = new ApiClient({
  getAccessToken: () => null,
  refresh: () => Promise.resolve(),
});

// Один SessionStore на host-флоу: gate ставит access-токен после refresh,
// login — после bootstrap по setup-токену (ADR-012 §2), setup/console
// расходуют его авторизованными вызовами. Страницы /host/* сменяются
// router-навигацией без перезагрузки, поэтому module-level экземпляр — способ
// разделить токен между ними; это состояние области /host в браузере, а не
// процессное состояние (REQ-CORE-004 — про сервер).
export const hostSession = new SessionStore(
  async () => (await refreshSession(anonClient)).accessToken,
);

// Авторизованный клиент host-области: 401 → silent refresh той же кукой → один
// retry (контракт ApiClient).
export const hostClient = new ApiClient(hostSession);
