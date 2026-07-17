import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { valid } from 'semver';
import {
  CONTRACT_VERSION,
  admitsUnboundedContractMajor,
  assertContractRangeSatisfied,
  isContractRangeSatisfied,
} from './contract-version';
import { ContractError } from './errors/error-codes';

describe('contract version', () => {
  it('is a valid semver version', () => {
    expect(valid(CONTRACT_VERSION)).not.toBeNull();
  });

  // REQ-CTR-004: "Версия SDK = версия контракта". Two sources of the same truth
  // drift; this test is what keeps them one.
  it('equals the SDK package version', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(pkg.version).toBe(CONTRACT_VERSION);
  });

  it.each(['^1.0.0', '>=1.0.0 <2.0.0', '1.x'])('accepts a compatible range: %s', (range) => {
    expect(isContractRangeSatisfied(range)).toBe(true);
  });

  it.each(['^2.0.0', '>=1.5.0', '0.9.x'])('rejects an incompatible range: %s', (range) => {
    expect(isContractRangeSatisfied(range)).toBe(false);
  });

  it.each(['garbage!!', '', 'not-a-range', '*'])(
    'rejects a range that constrains nothing or is malformed: %s',
    (range) => {
      expect(isContractRangeSatisfied(range)).toBe(false);
    },
  );

  // REQ-CTR-004: a manifest declares a *compatible* range. A range with no upper
  // bound claims compatibility with a contract major that does not exist yet — the
  // version gate would silently stop gating at the exact moment a breaking major
  // ships. The manifest schema refuses such ranges (owner decision 2026-07-18); this
  // is the predicate it delegates to.
  it.each(['^1.0.0', '~1.0.0', '1.x', '>=1.0.0 <2.0.0', '1.0.0 - 2.0.0'])(
    'a range bounded above admits no unbounded contract major: %s',
    (range) => {
      expect(admitsUnboundedContractMajor(range)).toBe(false);
    },
  );

  it.each(['>=1.0.0', '>=0.0.0-0', '*', '>=2.0.0', '>=1.0.0 <2.0.0 || >=3'])(
    'a range open above admits an unbounded contract major: %s',
    (range) => {
      expect(admitsUnboundedContractMajor(range)).toBe(true);
    },
  );

  it('treats a malformed range as admitting no major (validity is a separate check)', () => {
    expect(admitsUnboundedContractMajor('garbage!!')).toBe(false);
  });

  it('asserts with a typed error the core can return outward', () => {
    expect(() => assertContractRangeSatisfied('^1.0.0')).not.toThrow();
    try {
      assertContractRangeSatisfied('^2.0.0');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ContractError);
      expect((err as ContractError).code).toBe('CONTRACT_VERSION_INCOMPATIBLE');
    }
  });
});
