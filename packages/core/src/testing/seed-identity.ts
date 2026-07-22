import type { $Enums } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

// Test-side seeding of identity rows. No IdentityService exists in core by design
// (design §6: the first real flow — guest join or OAuth — will own it); until then
// tests are the only writers, via the Prisma client directly.
export function seedIdentity(
  prisma: PrismaService,
  data: {
    id?: string;
    kind?: $Enums.IdentityKind;
    email?: string | null;
    deletedAt?: Date | null;
  } = {},
) {
  return prisma.identity.create({
    data: {
      id: data.id,
      kind: data.kind ?? 'REGISTERED',
      email: data.email ?? null,
      deletedAt: data.deletedAt ?? null,
    },
  });
}
