import type { LogEvent } from '@prisma/client';
import type { AppManifest } from '@mymozhem/sdk';
import { ProjectionService } from './projection.service';

const ROW = {
  roomId: '11111111-1111-4111-8111-111111111111',
  seq: 1,
  schemaVersion: 1,
  recordedAt: new Date('2026-08-05T00:00:00Z'),
};

const events = [
  { ...ROW, seq: 1, type: 'core.room.activated', payload: { appId: 'quiz', manifestVersion: 1 }, actorId: null, visibility: 'PUBLIC' },
  { ...ROW, seq: 2, type: 'quiz.round.opened', payload: { round: 1 }, actorId: null, visibility: 'ORGANIZER' },
  { ...ROW, seq: 3, type: 'quiz.answer.recorded', payload: { ok: true }, actorId: '22222222-2222-4222-8222-222222222222', visibility: 'MODULE_PRIVATE' },
] as unknown as LogEvent[];

// Манифест с аннотациями x-visibility (REQ-CORE-008): rounds — public,
// seed — organizer, answers — без аннотации (fail-safe module-private).
const MANIFEST: AppManifest = {
  appId: 'quiz',
  manifestVersion: 1,
  contractRange: '^1.0.0',
  appSettings: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      rounds: { type: 'number', 'x-visibility': 'public' },
      seed: { type: 'string', 'x-visibility': 'organizer' },
      answers: { type: 'object' },
    },
  },
  events: {},
};

const SETTINGS = { rounds: 5, seed: 's3cret', answers: { r1: 2 } };

describe('ProjectionService', () => {
  const projection = new ProjectionService();

  it('public level sees only public events, without seq/visibility (REQ-RT-011a)', () => {
    const out = projection.projectEvents(events, 'public');
    expect(out).toEqual([
      { type: 'core.room.activated', payload: { appId: 'quiz', manifestVersion: 1 }, actorId: null },
    ]);
  });

  it('organizer level sees public + organizer, never module-private (REQ-CORE-005)', () => {
    const out = projection.projectEvents(events, 'organizer');
    expect(out.map((e) => e.type)).toEqual(['core.room.activated', 'quiz.round.opened']);
  });

  it('projected shape carries exactly type/payload/actorId', () => {
    const out = projection.projectEvents(events, 'organizer');
    for (const e of out) expect(Object.keys(e).sort()).toEqual(['actorId', 'payload', 'type']);
  });

  it('participant gets only public appSettings properties; unannotated is hidden (REQ-CORE-008)', () => {
    expect(projection.projectAppSettings(SETTINGS, MANIFEST, 'public')).toEqual({ rounds: 5 });
  });

  it('organizer gets public + organizer properties, never module-private', () => {
    expect(projection.projectAppSettings(SETTINGS, MANIFEST, 'organizer')).toEqual({
      rounds: 5,
      seed: 's3cret',
    });
  });

  it('property present in settings but absent from the schema is hidden (fail-safe)', () => {
    expect(
      projection.projectAppSettings({ ...SETTINGS, smuggled: true }, MANIFEST, 'organizer'),
    ).toEqual({ rounds: 5, seed: 's3cret' });
  });

  it('no manifest (unpinned DRAFT) or non-object settings → empty projection', () => {
    expect(projection.projectAppSettings(SETTINGS, undefined, 'organizer')).toEqual({});
    expect(projection.projectAppSettings(null, MANIFEST, 'organizer')).toEqual({});
  });
});
