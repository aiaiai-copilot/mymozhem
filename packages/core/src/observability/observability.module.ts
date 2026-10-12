import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsModule } from './metrics.module';
import { PinoLoggerModule, RequestIdModule } from './pino-logger.module';

// Фасад наблюдаемости (ф.4): /metrics + pino-конфигурация (батч C). Листовой —
// доменные модули импортируют его, не наоборот (observability-is-leaf).
// Порядок imports ЗНАЧИМ: RequestIdModule обязан зарегистрировать свой middleware
// раньше LoggerModule (см. pino-logger.module.ts) — оба @Global, решает порядок.
@Module({
  imports: [RequestIdModule, PinoLoggerModule, MetricsModule],
  controllers: [MetricsController],
  exports: [MetricsModule],
})
export class ObservabilityModule {}
