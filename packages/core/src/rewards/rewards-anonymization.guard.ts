import { Injectable } from '@nestjs/common';
import type { AnonymizationGuard } from '../identity/anonymization-guards';
import { PrismaService } from '../prisma/prisma.service';

// REQ-RWD-013: гость с нерешённой наградой (AWARDED; FULFILLED/REVOKED — решённые)
// не анонимизируется до разрешения — иначе приз осиротеет из-за обнуления имени
// победителя до вручения.
@Injectable()
export class RewardsAnonymizationGuard implements AnonymizationGuard {
  constructor(private readonly prisma: PrismaService) {}

  async hasOpenAwards(identityIds: readonly string[]): Promise<Set<string>> {
    if (identityIds.length === 0) return new Set();
    const rows = await this.prisma.award.findMany({
      where: { winnerId: { in: [...identityIds] }, status: 'AWARDED' },
      select: { winnerId: true },
    });
    return new Set(rows.map((r) => r.winnerId));
  }
}
