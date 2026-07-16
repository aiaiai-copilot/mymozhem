import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok'; db: true }> {
    const dbOk = await this.prisma.isHealthy();
    if (!dbOk) {
      throw new ServiceUnavailableException({ status: 'unavailable', db: false });
    }
    return { status: 'ok', db: true };
  }
}
