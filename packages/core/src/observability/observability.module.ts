import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsModule } from './metrics.module';

// Фасад наблюдаемости (ф.4): /metrics + (батч C) pino-конфигурация. Листовой —
// доменные модули импортируют его, не наоборот (observability-is-leaf).
@Module({
  imports: [MetricsModule],
  controllers: [MetricsController],
  exports: [MetricsModule],
})
export class ObservabilityModule {}
