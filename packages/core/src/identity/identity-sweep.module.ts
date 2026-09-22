import { Inject, Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { ConfigModule } from '../config/config.module';
import { IdentityModule } from './identity.module';
import { GuestSweepService } from './guest-sweep.service';

// Регистрация интервала свипа — только в composition root (этот модуль не
// импортируется тестами: логика свипа покрыта прямым вызовом sweepExpiredGuests).
// SchedulerRegistry резолвится из ScheduleModule.forRoot() composition root'а
// (глобальный после forRoot). Одна реплика (REQ-OPS-005) — дублей джобы нет.
@Injectable()
class GuestSweepScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(GuestSweepScheduler.name);

  constructor(
    private readonly sweep: GuestSweepService,
    private readonly registry: SchedulerRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const interval = setInterval(() => {
      this.sweep.sweepExpiredGuests().catch((err) => {
        // Отказ прохода — error-лог, следующий проход повторит; джоба не роняет процесс.
        this.logger.error('guest sweep failed', err);
      });
    }, this.config.CLEANUP_INTERVAL * 1000);
    this.registry.addInterval('guest-sweep', interval);
  }

  onApplicationShutdown(): void {
    // Симметрия жизненного цикла: onApplicationBootstrap срабатывает на listen(),
    // а e2e на app.inject() (init + close без listen) интервал не регистрирует —
    // deleteInterval бросил бы "No Interval was found". Снятие идемпотентно.
    if (this.registry.doesExist('interval', 'guest-sweep')) {
      this.registry.deleteInterval('guest-sweep');
    }
  }
}

@Module({
  imports: [ConfigModule, IdentityModule],
  providers: [GuestSweepScheduler],
})
export class IdentitySweepModule {}
