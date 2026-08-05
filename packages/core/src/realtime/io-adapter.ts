import { IoAdapter } from '@nestjs/platform-socket.io';
import type { AppConfig } from '../config/config.schema';

// CORS сокета повторяет HTTP-политику из того же конфига (design §8); wildcard в
// production запрещён superRefine конфиг-схемы (REQ-SEC-008). Подключается в
// apps/server main.ts и в e2e-boot (там своя копия boot-последовательности).
//
// httpServer обязателен: Nest НЕ инжектирует HTTP-сервер в пользовательский
// адаптер (useWebSocketAdapter лишь сохраняет его в конфиг), а IoAdapter без
// httpServer создаёт `new Server(port)` — socket.io слушал бы отдельный
// случайный порт, не тот, что у Fastify (вскрыто realtime e2e, Task 8).
// Канонический паттерн Nest: адаптер получает app/httpServer в конструкторе.
export class ConfigurableIoAdapter extends IoAdapter {
  constructor(
    private readonly config: AppConfig,
    httpServer: object,
  ) {
    super(httpServer);
  }

  override createIOServer(port: number, options?: Record<string, unknown>): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.config.CORS_ORIGINS },
    });
  }
}
