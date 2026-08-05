import { IoAdapter } from '@nestjs/platform-socket.io';
import type { AppConfig } from '../config/config.schema';

// CORS сокета повторяет HTTP-политику из того же конфига (design §8); wildcard в
// production запрещён superRefine конфиг-схемы (REQ-SEC-008). Подключается в
// apps/server main.ts и в e2e-boot (там своя копия boot-последовательности).
export class ConfigurableIoAdapter extends IoAdapter {
  constructor(private readonly config: AppConfig) {
    super();
  }

  override createIOServer(port: number, options?: Record<string, unknown>): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.config.CORS_ORIGINS },
    });
  }
}
