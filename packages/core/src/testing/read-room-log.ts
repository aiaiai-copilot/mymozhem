import type { PrismaService } from '../prisma/prisma.service';

export type RoomLogRow = {
  roomId: string;
  seq: number;
  type: string;
  payload: unknown;
  actorId: string | null;
  visibility: string;
  schemaVersion: number;
};

// Сырой читатель лога в его storage- (= контрактной) форме: enum как text, payload как
// JSON. Тестовый хелпер: read-path сервиса в ядре осознанно нет (design §10 — шов
// realtime read плана), тесты читают таблицу напрямую.
export function readRoomLog(prisma: PrismaService, roomId: string): Promise<RoomLogRow[]> {
  return prisma.$queryRaw<RoomLogRow[]>`
    SELECT "roomId", "seq", "type", "payload", "actorId",
           "visibility"::text AS "visibility", "schemaVersion"
    FROM realtime."LogEvent"
    WHERE "roomId" = ${roomId}::uuid
    ORDER BY "seq"
  `;
}
