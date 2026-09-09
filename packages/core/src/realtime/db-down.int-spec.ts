import type { AppManifest } from '@mymozhem/sdk';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { readRoomLog } from '../testing/read-room-log';
import { TEST_CONFIG } from '../testing/test-config';
import type { PrismaService } from '../prisma/prisma.service';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { MembershipService } from '../membership/membership.service';
import { JoinRateLimiter } from '../membership/join-rate-limiter';
import { IdentityService } from '../identity/identity.service';
import { RoomService } from '../room/room.service';
import { EventLogService } from './event-log.service';
import { EventEmitLimiter } from './event-emit-limiter';
import { RealtimeBus } from './realtime-bus';
import { EventOutbox } from './event-outbox';

const ORG = '00000000-0000-0000-0000-000000000001';
const P1 = '00000000-0000-0000-0000-0000000000a1';

// Тот же фикстурный манифест, что в event-commit.int-spec (design §7).
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
        additionalProperties: false,
      },
      visibility: 'public',
      clientInitiated: true,
    },
  },
};

// REQ-DEV-008, критерий выхода ф.1 «fail-closed тест при недоступности БД» —
// буквальная форма: БД реально остановлена (testcontainer), действие отклоняется
// (rejection — подтверждения клиенту нет), частичной записи не остаётся
// (верификация по ТОЙ ЖЕ БД после поднятия контейнера).
// Substance нормы (подтверждение только после фиксации, откат целиком) уже
// закрыт outbox-стэджингом и rollback-тестами; здесь — сам факт недоступности.
// Класс ошибки сознательно НЕ ассертится: при мёртвой БД это driver-level
// отказ (adapter-pg), который на проводе типизирует фильтр (INTERNAL_ERROR,
// без раскрытия деталей — http-exception.filter); свойство теста другое —
// «не подтверждено и ничего не записано».
//
// OrbStack переназначает host-порт при restart контейнера, поэтому после
// startContainer сервисы перевязываются на возвращённый клиент (wire()).
describe('Fail-closed при недоступной БД (REQ-DEV-008)', () => {
  let db: TestDb;
  let prisma: PrismaService; // текущий живой клиент; после рестарта — новый

  beforeAll(async () => {
    db = await startTestDb();
    prisma = db.prisma;
    await seedIdentity(prisma, { id: ORG, email: 'org@example.test' });
    await seedIdentity(prisma, { id: P1, kind: 'GUEST' });
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  function wire(p: PrismaService) {
    const registry = new AppRegistryService([TEST_APP]);
    const outbox = new EventOutbox(p, new RealtimeBus());
    const eventLog = new EventLogService(registry, new EventEmitLimiter(1000), TEST_CONFIG, outbox);
    const membership = new MembershipService(
      p,
      new IdentityService(p),
      new JoinRateLimiter(1000),
      TEST_CONFIG,
    );
    const rooms = new RoomService(p, eventLog, outbox, registry, membership, TEST_CONFIG);
    return { registry, outbox, eventLog, membership, rooms };
  }

  async function activeRoom(rooms: RoomService) {
    const room = await rooms.create(ORG);
    await rooms.configure(room.id, {
      appId: 'test-app',
      manifestVersion: 1,
      settings: { label: 'live' },
    });
    return rooms.activate(room.id);
  }

  it('commit при остановленной БД: отклонён, лог не изменился', async () => {
    const s = wire(prisma);
    const room = await activeRoom(s.rooms);
    await prisma.membership.create({
      data: { roomId: room.id, identityId: P1, role: 'PARTICIPANT' },
    });

    await db.stopContainer();
    try {
      await expect(
        s.outbox.run((tx) =>
          s.eventLog.commitAppEvent(tx, room.id, 'note.posted', { n: 1 }, 'public', P1),
        ),
      ).rejects.toThrow();
    } finally {
      prisma = await db.startContainer();
    }

    const log = await readRoomLog(prisma, room.id);
    expect(log).toHaveLength(1); // только core.room.activated — частичной записи нет
    expect(log[0]).toMatchObject({ seq: 1, type: 'core.room.activated' });
  }, 120000);

  it('join при остановленной БД: отклонён, membership и identity не созданы', async () => {
    const s = wire(prisma);
    const room = await s.rooms.create(ORG);

    await db.stopContainer();
    try {
      await expect(
        s.membership.join({ code: room.code, displayName: 'Late Guest', ip: '10.9.9.9' }),
      ).rejects.toThrow();
    } finally {
      prisma = await db.startContainer();
    }

    // Остался только ORGANIZER, созданный атомарно с комнатой до остановки;
    // гостевая identity из упавшей транзакции не осиротела.
    await expect(prisma.membership.count({ where: { roomId: room.id } })).resolves.toBe(1);
    await expect(prisma.identity.count({ where: { displayName: 'Late Guest' } })).resolves.toBe(0);
  }, 120000);
});
