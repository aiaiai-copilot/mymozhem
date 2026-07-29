import { Module } from '@nestjs/common';
import { APP_CONFIG } from './config.tokens';
import { loadConfig } from './config.schema';

@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
