import { Controller, Get, Res } from '@nestjs/common';
import { MetricsService } from './metrics.service';

// Core не знает fastify (ReplyLike-прецедент http-exception.filter): структурный
// минимум ответа; FastifyReply совместим по форме.
interface MetricsReply {
  header(name: string, value: string): unknown;
  send(body: string): unknown;
}

// REQ-OPS-004: экспозиция Prometheus text format. Открытый (решение владельца,
// дизайн ф.4 §0.3) — как /health; авторизация и CORS-гейты не применяются.
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  async getMetrics(@Res() reply: MetricsReply): Promise<void> {
    reply.header('Content-Type', this.metrics.contentType);
    reply.send(await this.metrics.render());
  }
}
