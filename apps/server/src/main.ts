import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { loadConfig } from '@mymozhem/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // REQ-SEC-002: конфиг (включая JWT_SECRET) валидируется до создания приложения —
  // старт с невалидным env невозможен (fail-closed, REQ-OPS-003).
  const config = loadConfig(process.env);
  // trustProxy — осознанное доверие X-Forwarded-For из конфига деплоя (REQ-ID-006,
  // parked minor): при false req.ip — непосредственный peer, XFF игнорируется.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: config.TRUST_PROXY }),
  );
  // Обязателен: transport-контроллеры читают req.cookies по структурному типу —
  // без плагина refresh вернёт 500 вместо 401.
  await app.register(fastifyCookie);
  await app.register(fastifyHelmet);
  // REQ-SEC-008: allowlist из конфига; пустой список = CORS-заголовки не выдаются.
  await app.register(fastifyCors, { origin: config.CORS_ORIGINS });
  await app.listen(config.PORT, '0.0.0.0');
}

void bootstrap();
