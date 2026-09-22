import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';
import { ANONYMIZATION_GUARDS, type AnonymizationGuard } from './anonymization-guards';

// Свип анонимизации гостей (REQ-ID-003/014, догон фазы 3): истечение guest_ttl
// реализуется анонимизацией строки (обнуление PII, сохранение id — внешние ключи
// и actorId в логе остаются валидными), не физическим удалением. База TTL —
// createdAt (решение владельца, design §0.8). Приостановка при открытой награде —
// через ANONYMIZATION_GUARDS (REQ-RWD-013); без подключённого rewards приостановки нет.
@Injectable()
export class GuestSweepService {
  private readonly logger = new Logger(GuestSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(ANONYMIZATION_GUARDS) private readonly guards: AnonymizationGuard[] = [],
  ) {}

  // Возвращает число анонимизированных identity. Вся выборка/гард/запись — одна
  // транзакция: гард-чек внутри неё закрывает окно гонки «награда создана между
  // чтением кандидатов и анонимизацией» (перечитывание deletedAt в updateMany —
  // вторая линия от гонки с ручным исключением).
  async sweepExpiredGuests(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.GUEST_TTL * 1000);
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.identity.findMany({
        where: { kind: 'GUEST', deletedAt: null, createdAt: { lt: cutoff } },
        select: { id: true },
      });
      if (candidates.length === 0) return 0;
      const ids = candidates.map((c) => c.id);
      const suspended = new Set<string>();
      for (const guard of this.guards) {
        for (const id of await guard.hasOpenAwards(ids)) suspended.add(id);
      }
      const sweepIds = ids.filter((id) => !suspended.has(id));
      if (sweepIds.length === 0) return 0;
      const anonymized = await tx.identity.updateMany({
        where: { id: { in: sweepIds }, deletedAt: null },
        data: { displayName: null, email: null, deletedAt: now },
      });
      // Отзыв живых сессий гостя — по прецеденту среза исключения
      // (membership.service.ts:118-123). Сессия гостя под приостановкой истекает
      // по своему капу как обычно (design §5) — здесь её нет.
      await tx.session.updateMany({
        where: { identityId: { in: sweepIds }, revokedAt: null },
        data: { revokedAt: now },
      });
      this.logger.log(`guest sweep: anonymized ${anonymized.count}, suspended ${suspended.size}`);
      return anonymized.count;
    });
  }
}
