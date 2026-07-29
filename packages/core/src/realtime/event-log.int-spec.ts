import { ContractError, validManifests } from '@mymozhem/sdk';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { readRoomLog } from '../testing/read-room-log';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { MembershipService } from '../membership/membership.service';
import type { AppConfig } from '../config/config.schema';
import { RoomService } from '../room/room.service';
import { EventLogService } from './event-log.service';

const ORG = '00000000-0000-0000-0000-000000000001';

const TEST_CONFIG: AppConfig = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://unused',
  ROOM_CODE_MIN_LEN: 8,
  ROOM_PARTICIPANT_LIMIT: 500,
  JOIN_RATE_LIMIT_IP: 20,
};

describe('EventLogService.commitCoreEvent', () => {
  let db: TestDb;
  let rooms: RoomService;
  let eventLog: EventLogService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    rooms = new RoomService(
      db.prisma,
      new EventLogService(),
      new AppRegistryService([validManifests[0]]),
      new MembershipService(db.prisma),
      TEST_CONFIG,
    );
    eventLog = new EventLogService();
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    // CASCADE чистит и realtime."LogEvent" (FK-ссылка), и room."Room".
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  it('commits one event with the contract shape (REQ-RT-001)', async () => {
    const room = await rooms.create(ORG);
    await db.prisma.$transaction((tx) =>
      eventLog.commitCoreEvent(tx, room.id, 'room.completed', {}),
    );

    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      seq: 1,
      type: 'core.room.completed',
      visibility: 'public', // REQ-RT-010
      actorId: null, // lifecycle/system — auth-контекста ещё нет
      payload: {},
      schemaVersion: 1,
    });
  });

  it('assigns dense per-room seq, independent across rooms', async () => {
    const a = await rooms.create(ORG);
    const b = await rooms.create(ORG);
    await db.prisma.$transaction((tx) => eventLog.commitCoreEvent(tx, a.id, 'room.completed', {}));
    await db.prisma.$transaction((tx) => eventLog.commitCoreEvent(tx, a.id, 'room.cancelled', {}));
    await db.prisma.$transaction((tx) => eventLog.commitCoreEvent(tx, b.id, 'room.cancelled', {}));

    expect((await readRoomLog(db.prisma, a.id)).map((e) => e.seq)).toEqual([1, 2]);
    expect((await readRoomLog(db.prisma, b.id)).map((e) => e.seq)).toEqual([1]);
  });

  it('rejects a payload mismatch with EVENT_PAYLOAD_INVALID and writes nothing', async () => {
    const room = await rooms.create(ORG);
    const err = await db.prisma
      .$transaction((tx) =>
        eventLog.commitCoreEvent(tx, room.id, 'room.completed', { bogus: 1 }),
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ContractError);
    expect((err as ContractError).code).toBe('EVENT_PAYLOAD_INVALID');
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);
  });

  it('serializes concurrent commits via the advisory lock: dense seqs 1..N (REQ-RT-007)', async () => {
    const room = await rooms.create(ORG);
    const N = 8;

    const committed = await Promise.all(
      Array.from({ length: N }, () =>
        db.prisma.$transaction((tx) =>
          eventLog.commitCoreEvent(tx, room.id, 'room.cancelled', {}),
        ),
      ),
    );

    // Детерминированное свойство, не статистика: все коммиты успешны,
    // seq — ровно множество {1..N} без дублей.
    expect(new Set(committed.map((e) => e.seq))).toEqual(
      new Set(Array.from({ length: N }, (_, i) => i + 1)),
    );
    expect((await readRoomLog(db.prisma, room.id)).map((e) => e.seq)).toEqual(
      Array.from({ length: N }, (_, i) => i + 1),
    );
  });
});
