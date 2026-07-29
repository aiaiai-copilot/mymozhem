import { validManifests } from '@mymozhem/sdk';
import { startTestDb, type TestDb } from '../testing/postgres.testcontainer';
import { seedIdentity } from '../testing/seed-identity';
import { readRoomLog } from '../testing/read-room-log';
import { EventLogService } from '../realtime/event-log.service';
import { AppRegistryService } from '../app-registry/app-registry.service';
import { AppManifestUnknownError, AppSettingsInvalidError } from '../app-registry/app-registry.errors';
import type { AppConfig } from '../config/config.schema';
import { RoomService } from './room.service';
import {
  RoomError,
  RoomTransitionError,
  RoomConflictError,
  RoomNotConfiguredError,
  RoomOrganizerNotRegisteredError,
  RoomSettingsFrozenError,
} from './room.errors';

const ORG = '00000000-0000-0000-0000-000000000001';

// quiz@1 из SDK-фикстур: appSettings требует { title: string, correctAnswers: number[] }.
const QUIZ_SETTINGS = { title: 'Friday quiz', correctAnswers: [0, 2] };

const TEST_CONFIG: AppConfig = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://unused',
  ROOM_CODE_MIN_LEN: 8,
  ROOM_PARTICIPANT_LIMIT: 500,
  JOIN_RATE_LIMIT_IP: 20,
};

const makeService = (db: TestDb) =>
  new RoomService(
    db.prisma,
    new EventLogService(),
    new AppRegistryService([validManifests[0]]),
    TEST_CONFIG,
  );

const configureQuiz = (service: RoomService, roomId: string) =>
  service.configure(roomId, { appId: 'quiz', manifestVersion: 1, settings: QUIZ_SETTINGS });

describe('RoomService lifecycle', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    service = makeService(db);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  it('create() yields a DRAFT room', async () => {
    const room = await service.create(ORG);
    expect(room.status).toBe('DRAFT');
    expect(room.deletedAt).toBeNull();
    expect(room.organizerId).toBe(ORG);
  });

  it('rejects a GUEST organizer with ROOM_ORGANIZER_NOT_REGISTERED (REQ-ID-005)', async () => {
    const guest = await seedIdentity(db.prisma, { kind: 'GUEST' });
    const err = await service.create(guest.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoomOrganizerNotRegisteredError);
    expect((err as RoomOrganizerNotRegisteredError).code).toBe('ROOM_ORGANIZER_NOT_REGISTERED');
  });

  it('rejects a nonexistent organizer with the same collapsed code', async () => {
    await expect(
      service.create('00000000-0000-0000-0000-0000000000aa'),
    ).rejects.toBeInstanceOf(RoomOrganizerNotRegisteredError);
  });

  it('rejects an anonymized (deletedAt) REGISTERED organizer', async () => {
    const ghost = await seedIdentity(db.prisma, { kind: 'REGISTERED', deletedAt: new Date() });
    await expect(service.create(ghost.id)).rejects.toBeInstanceOf(RoomOrganizerNotRegisteredError);
  });

  it('persists each legal transition', async () => {
    const a = await service.create(ORG);
    await configureQuiz(service, a.id);
    expect((await service.activate(a.id)).status).toBe('ACTIVE');
    expect((await service.complete(a.id)).status).toBe('COMPLETED');

    const b = await service.create(ORG);
    expect((await service.cancel(b.id)).status).toBe('CANCELLED');

    const c = await service.create(ORG);
    await configureQuiz(service, c.id);
    await service.activate(c.id);
    expect((await service.cancel(c.id)).status).toBe('CANCELLED');
  });

  it('rejects an illegal transition with ROOM_TRANSITION_INVALID', async () => {
    const room = await service.create(ORG);
    await expect(service.complete(room.id)).rejects.toBeInstanceOf(RoomTransitionError);
    // unchanged
    const reread = await db.prisma.room.findUnique({ where: { id: room.id } });
    expect(reread?.status).toBe('DRAFT');
  });

  it('rejects further transitions from a terminal status', async () => {
    const room = await service.create(ORG);
    await service.cancel(room.id);
    await expect(service.activate(room.id)).rejects.toBeInstanceOf(RoomTransitionError);
  });

  it('rejects transition of a missing room with ROOM_CONFLICT', async () => {
    await expect(
      service.activate('00000000-0000-0000-0000-0000000000ff'),
    ).rejects.toBeInstanceOf(RoomConflictError);
  });

  it('soft-deletes in DRAFT/COMPLETED/CANCELLED, refuses in ACTIVE', async () => {
    const draft = await service.create(ORG);
    expect((await service.softDelete(draft.id)).deletedAt).not.toBeNull();

    const active = await service.create(ORG);
    await configureQuiz(service, active.id);
    await service.activate(active.id);
    await expect(service.softDelete(active.id)).rejects.toBeInstanceOf(RoomTransitionError);

    const cancelled = await service.create(ORG);
    await service.cancel(cancelled.id);
    const deleted = await service.softDelete(cancelled.id);
    expect(deleted.deletedAt).not.toBeNull();
    // Orthogonality (REQ-RT-005): soft-delete is not a status — status must survive
    // softDelete unchanged.
    expect(deleted.status).toBe('CANCELLED');
  });

  it('a soft-deleted room is inert (transitions conflict)', async () => {
    const room = await service.create(ORG);
    await service.softDelete(room.id);
    await expect(service.activate(room.id)).rejects.toBeInstanceOf(RoomConflictError);
  });
});

describe('RoomService transition atomicity', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    service = makeService(db);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  // Deliberately NOT racing activate() vs cancel(): if the two calls happen to
  // serialize instead of interleave, the second one reads ACTIVE, and
  // ACTIVE -> CANCELLED is a *legal* edge — both would succeed and the test would
  // fail with no defect present. That pairing is schedule-dependent and cannot
  // prove atomicity.
  //
  // Racing cancel() vs cancel() on one DRAFT room has exactly one winner under
  // every possible schedule:
  //   - Interleaved: both read DRAFT, both pass assertTransition, both issue the
  //     guarded UPDATE; one affects 1 row, the loser affects 0 rows -> RoomConflictError.
  //   - Serialized: the loser reads CANCELLED, which is terminal, so
  //     assertTransition itself throws -> RoomTransitionError.
  // Either outcome is a legitimate proof that only one CANCELLED transition ever
  // lands; which specific error class the loser gets depends on the (unobservable)
  // schedule. Do not tighten the assertion below to one subclass — that would
  // reintroduce the same flakiness this test is designed to avoid.
  it('two competing cancels on one room: exactly one wins, the other is rejected', async () => {
    const room = await service.create(ORG);

    const results = await Promise.allSettled([service.cancel(room.id), service.cancel(room.id)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(RoomError);

    const finalStatus = (await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
      .status;
    expect(finalStatus).toBe('CANCELLED');
  });
});

describe('Room CHECK constraint: soft-delete is incompatible with ACTIVE', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    service = makeService(db);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  // RoomService can never produce this write: softDelete() guards against ACTIVE, and no
  // transition can reach ACTIVE while deletedAt is already set. Go around the service with
  // raw SQL to prove the invariant is enforced by the database itself (the
  // Room_softdelete_not_active CHECK constraint), not merely by application code
  // (REQ-RWD-010 philosophy: DB invariant, not check-before-write).
  it('rejects an UPDATE that sets deletedAt on an ACTIVE room, at the database level', async () => {
    const room = await service.create(ORG);
    await configureQuiz(service, room.id);
    await service.activate(room.id);

    await expect(
      db.prisma.$executeRawUnsafe(`UPDATE room."Room" SET "deletedAt" = now() WHERE id = $1`, room.id),
    ).rejects.toThrow(/Room_softdelete_not_active/);

    // Unaffected: the rejected write must not have partially applied.
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.deletedAt).toBeNull();
    expect(reread.status).toBe('ACTIVE');
  });

  it('rejects an INSERT of a row that is both ACTIVE and soft-deleted, at the database level', async () => {
    await expect(
      db.prisma.$executeRawUnsafe(
        `INSERT INTO room."Room" (id, "organizerId", status, code, "deletedAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, 'ACTIVE', 'rawcheck1', now(), now())`,
        ORG,
      ),
    ).rejects.toThrow(/Room_softdelete_not_active/);
  });
});

describe('Room organizerId FK', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  // Raw SQL around the service: the database itself must refuse an organizer that
  // does not exist in identity."Identity" (declarative FK, REQ-ID-005).
  it('rejects a room whose organizerId is not an identity, at the database level', async () => {
    await expect(
      db.prisma.$executeRawUnsafe(
        `INSERT INTO room."Room" (id, "organizerId", status, code, "updatedAt")
         VALUES (gen_random_uuid(), $1, 'DRAFT', 'rawfk001', now())`,
        '00000000-0000-0000-0000-0000000000ee',
      ),
    ).rejects.toThrow(/Room_organizerId_fkey/);
  });
});

describe('RoomService lifecycle log emit (REQ-RT-010)', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    service = makeService(db);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  it('full path DRAFT→ACTIVE→COMPLETED emits room.activated (pin) then room.completed', async () => {
    const room = await service.create(ORG);
    await configureQuiz(service, room.id);
    await service.activate(room.id);
    await service.complete(room.id);

    // REQ-RT-010 3/3: обе строки public; activated несёт пин замороженной тройки
    // (REQ-RT-004). Регрессионный якорь среза lifecycle-эмита обновлён: 1 строка → 2.
    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      seq: 1,
      type: 'core.room.activated',
      visibility: 'public',
      actorId: null,
      payload: { appId: 'quiz', manifestVersion: 1 },
      schemaVersion: 1,
    });
    expect(log[1]).toMatchObject({
      seq: 2,
      type: 'core.room.completed',
      visibility: 'public',
      actorId: null,
      payload: {},
      schemaVersion: 1,
    });
  });

  it('cancel() from DRAFT and from ACTIVE emits core.room.cancelled', async () => {
    const a = await service.create(ORG);
    await service.cancel(a.id);
    const b = await service.create(ORG);
    await configureQuiz(service, b.id);
    await service.activate(b.id);
    await service.cancel(b.id);

    expect((await readRoomLog(db.prisma, a.id)).map((e) => e.type)).toEqual(['core.room.cancelled']);
    expect((await readRoomLog(db.prisma, b.id)).map((e) => [e.seq, e.type])).toEqual([
      [1, 'core.room.activated'],
      [2, 'core.room.cancelled'],
    ]);
  });

  it('emits nothing on illegal transition, terminal transition, create or softDelete', async () => {
    const room = await service.create(ORG);
    await expect(service.complete(room.id)).rejects.toBeInstanceOf(RoomTransitionError);
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);

    await configureQuiz(service, room.id);
    await service.activate(room.id);
    await service.complete(room.id);
    await expect(service.cancel(room.id)).rejects.toBeInstanceOf(RoomTransitionError);
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(2); // activated + completed

    const plain = await service.create(ORG);
    await service.softDelete(plain.id);
    expect(await readRoomLog(db.prisma, plain.id)).toHaveLength(0);
  });

  it('two competing cancels emit exactly one event, from the winner (atomicity)', async () => {
    const room = await service.create(ORG);

    await Promise.allSettled([service.cancel(room.id), service.cancel(room.id)]);

    // Проигравший откатился целиком: ни статуса, ни события (REQ-DEV-008).
    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ seq: 1, type: 'core.room.cancelled', visibility: 'public' });
    expect(
      (await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } })).status,
    ).toBe('CANCELLED');
  });
});

describe('Room config triple CHECK constraint (REQ-RT-004)', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    service = makeService(db);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  it('accepts an all-NULL triple and a fully-set triple', async () => {
    const room = await service.create(ORG); // тройка NULL
    await db.prisma.$executeRawUnsafe(
      `UPDATE room."Room"
       SET "appId" = 'quiz', "manifestVersion" = 1, "appSettings" = '{}'::jsonb
       WHERE id = $1`,
      room.id,
    );
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.appId).toBe('quiz');
    expect(reread.manifestVersion).toBe(1);
  });

  // Инвариант тройки (design §2): либо все NULL, либо все заданы. Сервис такую запись
  // не производит никогда (единственный путь — configure, Task 3), поэтому проверяем
  // сырым SQL, что инвариант держит сама БД (философия REQ-RWD-010).
  it.each([
    { set: `"appId" = 'quiz'`, label: 'appId without the rest' },
    { set: `"appId" = 'quiz', "manifestVersion" = 1`, label: 'pin without appSettings' },
    { set: `"appSettings" = '{}'::jsonb`, label: 'appSettings without the pin' },
  ])('rejects a partial triple at the database level ($label)', async ({ set }) => {
    const room = await service.create(ORG);
    await expect(
      db.prisma.$executeRawUnsafe(`UPDATE room."Room" SET ${set} WHERE id = $1`, room.id),
    ).rejects.toThrow(/Room_config_triple/);
  });
});

describe('RoomService.configure (REQ-RT-004)', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    service = makeService(db);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  it('persists the full config triple on a DRAFT room', async () => {
    const room = await service.create(ORG);
    const configured = await configureQuiz(service, room.id);
    expect(configured.appId).toBe('quiz');
    expect(configured.manifestVersion).toBe(1);
    expect(configured.appSettings).toEqual(QUIZ_SETTINGS);
  });

  it('replaces the whole triple on re-configure', async () => {
    const room = await service.create(ORG);
    await configureQuiz(service, room.id);
    const next = { title: 'Other quiz', correctAnswers: [1] };
    const reconfigured = await service.configure(room.id, {
      appId: 'quiz',
      manifestVersion: 1,
      settings: next,
    });
    expect(reconfigured.appSettings).toEqual(next);
  });

  it('rejects invalid settings with APP_SETTINGS_INVALID and leaves the row unchanged', async () => {
    const room = await service.create(ORG);
    const err = await service
      .configure(room.id, { appId: 'quiz', manifestVersion: 1, settings: { title: 'x' } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppSettingsInvalidError);
    expect((err as AppSettingsInvalidError).code).toBe('APP_SETTINGS_INVALID');
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.appId).toBeNull();
    expect(reread.appSettings).toBeNull();
  });

  it('rejects an unknown manifest with APP_MANIFEST_UNKNOWN', async () => {
    const room = await service.create(ORG);
    const err = await service
      .configure(room.id, { appId: 'quiz', manifestVersion: 99, settings: QUIZ_SETTINGS })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppManifestUnknownError);
    expect((err as AppManifestUnknownError).code).toBe('APP_MANIFEST_UNKNOWN');
  });

  it.each([
    {
      name: 'ACTIVE',
      setup: async (s: RoomService, id: string) => {
        await configureQuiz(s, id);
        await s.activate(id);
      },
    },
    { name: 'CANCELLED', setup: async (s: RoomService, id: string) => { await s.cancel(id); } },
    { name: 'soft-deleted', setup: async (s: RoomService, id: string) => { await s.softDelete(id); } },
  ])('rejects configure on a $name room with ROOM_SETTINGS_FROZEN', async ({ setup }) => {
    const room = await service.create(ORG);
    await setup(service, room.id);
    const err = await configureQuiz(service, room.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoomSettingsFrozenError);
    expect((err as RoomSettingsFrozenError).code).toBe('ROOM_SETTINGS_FROZEN');
  });

  it('rejects configure of a missing room with the same collapsed code', async () => {
    await expect(
      service.configure('00000000-0000-0000-0000-0000000000ff', {
        appId: 'quiz',
        manifestVersion: 1,
        settings: QUIZ_SETTINGS,
      }),
    ).rejects.toBeInstanceOf(RoomSettingsFrozenError);
  });
});

describe('RoomService activation gate (REQ-RT-004, REQ-CORE-007)', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    service = makeService(db);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  it('rejects activation of an unconfigured room; room stays DRAFT, log stays empty', async () => {
    const room = await service.create(ORG);
    const err = await service.activate(room.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoomNotConfiguredError);
    expect((err as RoomNotConfiguredError).code).toBe('ROOM_NOT_CONFIGURED');
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.status).toBe('DRAFT');
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);
  });

  // Перевалидация при активации — не декорация (design §5): подменяем настройки
  // напрямую в БД минуя сервис (configure такое не запишет) — активация обязана
  // отклонить и откатиться целиком (REQ-DEV-008).
  it('re-validates settings at activation: tampered appSettings roll everything back', async () => {
    const room = await service.create(ORG);
    await configureQuiz(service, room.id);
    await db.prisma.$executeRawUnsafe(
      `UPDATE room."Room" SET "appSettings" = '{}'::jsonb WHERE id = $1`,
      room.id,
    );
    const err = await service.activate(room.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppSettingsInvalidError);
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.status).toBe('DRAFT');
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);
  });

  // Реестр boot-time, строка комнаты durable: активация против версии, которой нет
  // в реестре процесса (редеплой убрал), обязана отказать (design §5).
  it('rejects activation when the pinned manifest is absent from the registry', async () => {
    const room = await service.create(ORG);
    await configureQuiz(service, room.id);
    const emptyRegistryService = new RoomService(
      db.prisma,
      new EventLogService(),
      new AppRegistryService([]),
      TEST_CONFIG,
    );
    const err = await emptyRegistryService.activate(room.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppManifestUnknownError);
    const reread = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reread.status).toBe('DRAFT');
    expect(await readRoomLog(db.prisma, room.id)).toHaveLength(0);
  });

  // Гонка configure vs activate (design §5): row-lock guarded UPDATE активации —
  // точка сериализации. Ровно одно из двух: configure успел (активирована новая
  // тройка) или получил ROOM_SETTINGS_FROZEN (активирована прежняя). Пин в событии
  // совпадает с замороженной строкой при любом исходе. НЕ сужать до одного исхода —
  // расписание ненаблюдаемо (прецедент: race-тест cancel/cancel).
  it('configure vs activate race: one winner, pin in the event matches the frozen row', async () => {
    const room = await service.create(ORG);
    await configureQuiz(service, room.id);
    const newSettings = { title: 'Raced quiz', correctAnswers: [3] };

    const [cfg, act] = await Promise.allSettled([
      service.configure(room.id, { appId: 'quiz', manifestVersion: 1, settings: newSettings }),
      service.activate(room.id),
    ]);

    const final = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(final.status).toBe('ACTIVE');
    expect(act.status).toBe('fulfilled');
    if (cfg.status === 'rejected') {
      expect(cfg.reason).toBeInstanceOf(RoomSettingsFrozenError);
      expect(final.appSettings).toEqual(QUIZ_SETTINGS);
    } else {
      expect(final.appSettings).toEqual(newSettings);
    }
    const log = await readRoomLog(db.prisma, room.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      seq: 1,
      type: 'core.room.activated',
      payload: { appId: final.appId, manifestVersion: final.manifestVersion },
    });
  });
});

describe('RoomService.create room code and join policy (REQ-ID-013, REQ-ID-002)', () => {
  let db: TestDb;
  let service: RoomService;

  beforeAll(async () => {
    db = await startTestDb();
    await seedIdentity(db.prisma, { id: ORG, email: 'org@example.test' });
    service = makeService(db);
  }, 120000);

  afterAll(async () => {
    await db.stop();
  });

  afterEach(async () => {
    await db.prisma.$executeRawUnsafe('TRUNCATE TABLE room."Room" CASCADE');
  });

  it('creates a room with an 8-char safe-alphabet code and guests policy by default', async () => {
    const room = await service.create(ORG);
    expect(room.code).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
    expect(room.joinPolicy).toBe('GUESTS');
  });

  it('generates distinct codes for two rooms', async () => {
    const a = await service.create(ORG);
    const b = await service.create(ORG);
    expect(a.code).not.toBe(b.code);
  });

  it('honours an explicit join policy', async () => {
    const room = await service.create(ORG, 'registered');
    expect(room.joinPolicy).toBe('REGISTERED');
  });

  it('rejects an invalid join policy before touching the DB', async () => {
    await expect(service.create(ORG, 'public' as never)).rejects.toThrow();
  });
});
