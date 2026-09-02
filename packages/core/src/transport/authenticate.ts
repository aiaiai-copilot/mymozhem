import { TokenService, type AccessClaims } from '../auth/token.service';
import type { RequestLike } from './http.types';

// Bearer-аутентификация REST (первый потребитель — ExcludeController, срез исключения;
// вынос при втором — RoomsController, OAuth-срез). Невалидный/отсутствующий токен —
// AuthError SESSION_INVALID (фильтр → 401). actorId — только из токена (REQ-RT-009 по духу HTTP).
export function authenticate(req: RequestLike, tokens: TokenService): AccessClaims {
  const header = req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  return tokens.verifyAccessToken(token);
}
