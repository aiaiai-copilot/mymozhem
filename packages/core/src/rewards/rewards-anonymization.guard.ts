import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AnonymizationGuard } from '../identity/anonymization-guards';

// REQ-RWD-013: гость с нерешённой наградой (AWARDED; FULFILLED/REVOKED — решённые)
// не анонимизируется до разрешения — иначе приз осиротеет из-за обнуления имени
// победителя до вручения.
@Injectable()
export class RewardsAnonymizationGuard implements AnonymizationGuard {
  // PrismaService больше не инжектируется (C-8.1, ф.4): чтение строго через tx
  // вызывающего — внетранзакционное чтение создавало окно гонки со свипом.
  async hasOpenAwards(tx: Prisma.TransactionClient, identityIds: readonly string[]): Promise<Set<string>> {
    if (identityIds.length === 0) return new Set();
    const rows = await tx.award.findMany({
      where: { winnerId: { in: [...identityIds] }, status: 'AWARDED' },
      select: { winnerId: true },
    });
    return new Set(rows.map((r) => r.winnerId));
  }
}
