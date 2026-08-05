import type { AppManifest } from '@mymozhem/sdk';
import type { LogEvent } from '@prisma/client';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { readRoomLog } from '../testing/read-room-log';
import { TEST_CONFIG } from '../testing/test-config';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { MembershipService } from '../membership/membership.service';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { IdentityService } from '../identity/identity.service';
import { RoomService } from '../room/room.service';
import { EventLogService } from './event-log.service';
import { EventEmitLimiter } from './event-emit-limiter';
import { RealtimeBus } from './realtime-bus';
import {
  EventOutbox,
  EventOutboxMissingContextError,
  EventOutboxNestedRunError,
} from './event-outbox';

const ORG = '00000000-0000-0000-0000-000000000001';
const P1 = '00000000-0000-0000-0000-0000000000a1';

const TEST_APP: AppManifest = {
  appId: 'test-app',
  manifestVersion: 1,
  contractRange: '^1.0.0',
  appSettings: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { label: { type: 'string' } },
  },
  events: {
    'note.posted': {
      schema: {
        type: 'object',
        properties: { n: { type: 'number' } },
        required: ['n'],
        additionalProperties: true,
      },
      visibility: 'public',
    },
  },
};

describe('EventOutbox', () => {
  let db: TestDb;
  let bus: RealtimeBus;
  let outbox: EventOutbox;
  let eventLog: EventLogService;
  let rooms: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    await seedIdentity(db.prisma, { id: P1, kind: 'GUEST' });
    const registry = new AppRegistryService([TEST_APP]);
    bus = new RealtimeBus();
    outbox = new EventOutbox(db.prisma, bus);
    eventLog = new EventLogService(registry, new EventEmitLimiter(1000), TEST_CONFIG, outbox);
    rooms = new RoomService(
      db.prisma,
      eventLog,
      outbox,
      registry,
      new MembershipService(db.prisma, new IdentityService(db.prisma), new JoinRateLimiter(1000), TEST_CONFIG),
      TEST_CONFIG,
    );
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  async function activeRoom() {
    const room = await rooms.create(ORG);
    await rooms.configure(room.id, {
      appId: 'test-app',
      manifestVersion: 1,
      settings: { label: 'live' },
    });
    return rooms.activate(room.id);
  }

  it('delivers committed events exactly once, after commit', async () => {
    const room = await activeRoom();
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' } });
    const delivered: string[] = [];
    let publishCalls = 0;
    bus.subscribe((events) => {
      publishCalls += 1;
      delivered.push(...events.map((e) => e.type));
    });

    await outbox.run((tx) => eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1));

    expect(delivered).toEqual(['test-app.note.posted']);
    expect(publishCalls).toBe(1);
    expect((await readRoomLog(db.prisma, room.id)).map((e) => e.type)).toEqual([
      'core.room.activated',
      'test-app.note.posted',
    ]);
  });

  it('batches several events of one transaction into a single publish', async () => {
    const room = await activeRoom();
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' } });
    const batches: number[] = [];
    bus.subscribe((events) => batches.push(events.length));

    await outbox.run(async (tx) => {
      await eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1);
      await eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 2 }, 'public', P1);
    });

    expect(batches).toEqual([2]);
  });

  it('delivered events carry the Prisma-enum visibility (LogEvent contract for fan-out)', async () => {
    const room = await activeRoom();
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' } });
    const delivered: LogEvent[] = [];
    bus.subscribe((events) => delivered.push(...events));

    await outbox.run((tx) => eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1));

    // INSERT ... RETURNING * отдаёт сырую DB-метку enum ('public'); staged событие
    // обязано быть нормализовано до Prisma-enum — fan-out gateway сравнивает
    // visibility с 'PUBLIC' (вскрыто realtime e2e, Task 8: live-доставка пропадала).
    expect(delivered.map((e) => e.visibility)).toEqual(['PUBLIC']);
  });

  it('rollback delivers nothing and writes nothing (REQ-DEV-008)', async () => {
    const room = await activeRoom();
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' } });
    let publishCalls = 0;
    bus.subscribe(() => {
      publishCalls += 1;
    });

    await expect(
      outbox.run(async (tx) => {
        await eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1);
        throw new Error('boom after commit');
      }),
    ).rejects.toThrow('boom after commit');

    expect(publishCalls).toBe(0);
    expect((await readRoomLog(db.prisma, room.id)).map((e) => e.type)).toEqual(['core.room.activated']);
  });

  it('fail-closed: commit inside a bare prisma.$transaction throws (no delivery path)', async () => {
    const room = await activeRoom();
    await db.prisma.membership.create({ data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' } });

    await expect(
      db.prisma.$transaction((tx) =>
        eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1),
      ),
    ).rejects.toBeInstanceOf(EventOutboxMissingContextError);
  });

  it('nested run is refused', async () => {
    await expect(outbox.run(() => outbox.run(async () => undefined))).rejects.toBeInstanceOf(
      EventOutboxNestedRunError,
    );
  });

  it('RoomService.transition delivers lifecycle events to subscribers (REQ-RT-010)', async () => {
    const delivered: string[] = [];
    bus.subscribe((events) => delivered.push(...events.map((e) => e.type)));

    const room = await rooms.create(ORG);
    await rooms.configure(room.id, { appId: 'test-app', manifestVersion: 1, settings: { label: 'x' } });
    await rooms.activate(room.id);
    await rooms.complete(room.id);

    expect(delivered).toEqual(['core.room.activated', 'core.room.completed']);
  });
});
