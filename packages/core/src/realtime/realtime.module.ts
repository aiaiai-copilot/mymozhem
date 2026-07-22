import { Module } from '@nestjs/common';
import { EventLogService } from './event-log.service';

// PrismaModule намеренно НЕ импортируется: примитив работает на транзакционном
// клиенте вызывающего (атомарность «действие + лог», REQ-DEV-008).
@Module({
  providers: [EventLogService],
  exports: [EventLogService],
})
export class RealtimeModule {}
