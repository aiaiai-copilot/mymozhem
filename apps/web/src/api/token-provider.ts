// Порт хранилища сессии (дизайн §3): клиент не знает, где живёт access-токен —
// реализация (SessionStore, Task 10) подставляется снаружи. refresh() — silent
// POST /auth/refresh по httpOnly-куке; после него getAccessToken() обязан отдавать
// уже новый токен, иначе retry уйдёт со старым.
export interface TokenProvider {
  getAccessToken(): string | null;
  refresh(): Promise<void>;
}
