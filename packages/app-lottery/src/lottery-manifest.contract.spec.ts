import Ajv2020 from 'ajv/dist/2020';
import {
  appManifestSchema,
  readPropertyVisibility,
  type Visibility,
} from '@mymozhem/sdk';
import { buildLotteryManifest, LOTTERY_APP_ID, LOTTERY_MANIFEST_VERSION } from './lottery-manifest';
import { lotterySettingsSchema } from './lottery-settings';

// REQ-CTR-005: манифест лотереи валидируется против контракта, под которым он
// живёт, — appManifestSchema для формы, Ajv поверх ЗАРЕГИСТРИРОВАННЫХ JSON Schema
// для того, что ядро реально принуждает (REQ-CORE-007). Zod-исходники — поверхность
// авторства; зарегистрированные снапшоты — артефакт.
const manifest = buildLotteryManifest();

const ajv = new Ajv2020({ allErrors: true, strict: false });

const D1 = 'd1e1f1a2-0002-4a02-8002-000000000002';
const P1 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const W1 = 'a3a8d3e1-9e5b-4f1c-8a2b-3c4d5e6f7081';

const EXPECTED_EVENTS = {
  'draw.run': { visibility: 'public', clientInitiated: true },
  'draw.completed': { visibility: 'public', clientInitiated: false },
} as const;

describe('lottery manifest', () => {
  it('satisfies the manifest contract (appManifestSchema)', () => {
    expect(appManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('carries the lottery identity', () => {
    expect(manifest.appId).toBe(LOTTERY_APP_ID);
    expect(manifest.appId).toBe('lottery');
    expect(manifest.manifestVersion).toBe(LOTTERY_MANIFEST_VERSION);
    expect(manifest.manifestVersion).toBe(1);
  });

  it('declares the rewards capability (REQ-RWD-001/005)', () => {
    expect(manifest.capabilities).toEqual(['rewards']);
  });

  it('registers exactly the 2 lottery event types', () => {
    expect(Object.keys(manifest.events).sort()).toEqual(Object.keys(EXPECTED_EVENTS).sort());
  });

  it.each(Object.entries(EXPECTED_EVENTS))(
    'event %s declares visibility=%s and clientInitiated=%s',
    (name, expected: { visibility: Visibility; clientInitiated: boolean }) => {
      const event = manifest.events[name];
      expect(event?.visibility).toBe(expected.visibility);
      expect(event?.clientInitiated).toBe(expected.clientInitiated);
    },
  );
});

describe('registered appSettings JSON Schema', () => {
  const validate = ajv.compile(manifest.appSettings);

  // Зарегистрированный артефакт (z.toJSONSchema, output-режим) требует ключ
  // drawEligibility явно: ядро валидирует verdict-only, без коэрсии (REQ-CORE-007).
  // Дефолт guests_allowed живёт на zod-уровне (защитный parse в handler'е).
  it('rejects an empty settings snapshot (drawEligibility required in the registered schema)', () => {
    expect(validate({})).toBe(false);
  });

  it.each([['guests_allowed'], ['verified']] as const)('accepts drawEligibility=%s', (drawEligibility) => {
    expect(validate({ drawEligibility })).toBe(true);
  });

  it('rejects an unknown drawEligibility value', () => {
    expect(validate({ drawEligibility: 'everyone' })).toBe(false);
  });

  it('rejects an unknown extra key', () => {
    expect(validate({ bogus: 1 })).toBe(false);
  });

  it('defaults drawEligibility to guests_allowed (REQ-RWD-014)', () => {
    expect(lotterySettingsSchema.parse({}).drawEligibility).toBe('guests_allowed');
  });

  it('exposes drawEligibility as public', () => {
    expect(readPropertyVisibility(manifest.appSettings, 'drawEligibility')).toBe('public');
  });
});

describe('registered event JSON Schemas', () => {
  const validatorFor = (name: string) => {
    const entry = manifest.events[name];
    if (!entry) {
      throw new Error(`no such event in the lottery manifest: ${name}`);
    }
    return ajv.compile(entry.schema);
  };

  const PAYLOAD_CASES: ReadonlyArray<readonly [string, string, unknown, boolean]> = [
    ['draw.run accepts a valid payload', 'draw.run', { drawId: D1, prizeId: P1 }, true],
    ['draw.run rejects an invalid drawId uuid', 'draw.run', { drawId: 'not-a-uuid', prizeId: P1 }, false],
    ['draw.run rejects an invalid prizeId uuid', 'draw.run', { drawId: D1, prizeId: 'not-a-uuid' }, false],
    ['draw.run rejects a missing prizeId', 'draw.run', { drawId: D1 }, false],
    ['draw.run rejects an extra key', 'draw.run', { drawId: D1, prizeId: P1, extra: 1 }, false],
    [
      'draw.completed accepts a valid payload',
      'draw.completed',
      { drawId: D1, prizeId: P1, winnerId: W1 },
      true,
    ],
    [
      'draw.completed rejects a missing winnerId',
      'draw.completed',
      { drawId: D1, prizeId: P1 },
      false,
    ],
    [
      'draw.completed rejects an invalid winnerId uuid',
      'draw.completed',
      { drawId: D1, prizeId: P1, winnerId: 'not-a-uuid' },
      false,
    ],
    [
      'draw.completed rejects an extra key',
      'draw.completed',
      { drawId: D1, prizeId: P1, winnerId: W1, extra: 1 },
      false,
    ],
  ];

  it.each(PAYLOAD_CASES)('%s', (_description, eventName, payload, expectedValid) => {
    expect(validatorFor(eventName)(payload)).toBe(expectedValid);
  });
});
