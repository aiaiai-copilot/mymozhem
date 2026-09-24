import fastifyStatic from '@fastify/static';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AppConfig } from '@mymozhem/core';

// API-префиксы провода ядра: их 404 обязаны оставаться JSON и никогда не
// подменяться SPA-страницей (Review Focus 5, дизайн §2).
const API_PREFIXES = ['/rooms', '/auth', '/health', '/socket.io'];

// fastify — транзитивная зависимость (через @nestjs/platform-fastify), pnpm не
// резолвит её из apps/server напрямую, поэтому scope/req/reply типизируем
// структурно (прецедент — ReplyLike в core/transport/http-exception.filter.ts).
interface RequestLike {
  url?: string;
  method?: string;
}

interface ReplyLike {
  // sendFile появляется на reply после регистрации @fastify/static.
  sendFile(path: string): unknown;
  status(statusCode: number): { send(body: unknown): unknown };
}

interface StaticScope {
  register(plugin: unknown, options: { root: string }): unknown;
  setNotFoundHandler(handler: (req: RequestLike, reply: ReplyLike) => unknown): unknown;
}

// UI-срез (дизайн §2): same-origin раздача SPA из того же Docker-артефакта —
// браузер и API живут на одном origin, CORS не нужен. WEB_STATIC_DIR не задан →
// статики нет, поведение прежнее (dev/test). Вынесено из main.ts, чтобы e2e
// пинил production-код раздачи, а не зеркальную копию bootstrap.
//
// ВАЖНО: вызывать ПОСЛЕ app.init(). Nest ставит свой not-found handler на
// корень при init, причём отложенно — через avvio-очередь (выполняется при
// ready/listen). Fastify запрещает второй handler на том же префиксе в том же
// контексте, поэтому fallback живёт в encapsulated-контексте с prefix '/':
// такой контекст получает собственный 404-уровень (arrange404), и его handler
// выигрывает у корневого — но только если встал в очередь ПОЗЖЕ корневого,
// то есть после init.
export async function registerStaticWeb(
  app: NestFastifyApplication,
  config: AppConfig,
): Promise<void> {
  if (!config.WEB_STATIC_DIR) return;
  const root = config.WEB_STATIC_DIR;
  await app.register(
    async (scope: StaticScope) => {
      await scope.register(fastifyStatic, { root });
      scope.setNotFoundHandler((req: RequestLike, reply: ReplyLike) => {
        const url = req.url ?? '';
        if (req.method === 'GET' && !API_PREFIXES.some((prefix) => url.startsWith(prefix))) {
          return reply.sendFile('index.html');
        }
        return reply.status(404).send({ code: 'NOT_FOUND' });
      });
    },
    { prefix: '/' },
  );
}
