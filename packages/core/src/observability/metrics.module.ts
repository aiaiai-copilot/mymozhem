import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';

// Листовой модуль наблюдаемости (boundary observability-is-leaf, Task 6):
// доменные модули импортируют его, сам он доменных не знает.
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
