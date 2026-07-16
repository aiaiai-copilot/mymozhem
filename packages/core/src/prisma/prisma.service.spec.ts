import { PrismaService } from './prisma.service';

describe('PrismaService.isHealthy', () => {
  it('returns true when the query succeeds', async () => {
    const svc = new PrismaService();
    jest.spyOn(svc, '$queryRaw' as never).mockResolvedValue([{ '?column?': 1 }] as never);
    await expect(svc.isHealthy()).resolves.toBe(true);
  });

  it('returns false when the query throws', async () => {
    const svc = new PrismaService();
    jest.spyOn(svc, '$queryRaw' as never).mockRejectedValue(new Error('no db') as never);
    await expect(svc.isHealthy()).resolves.toBe(false);
  });
});
