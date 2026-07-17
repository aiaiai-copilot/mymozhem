import { satisfies, validRange } from 'semver';
import { ContractError } from './errors/error-codes';

// The version of the core↔module contract. REQ-CTR-004: the SDK version IS the
// contract version — packages/sdk/package.json is kept equal to this by a contract
// test. Versioning from day one is the enforcement mechanism of the boundary, not
// preparation for a future consumer (ADR-002).
export const CONTRACT_VERSION = '1.0.0';

// A manifest declares the range of contract versions it is compatible with; the
// core checks it at registration (REQ-CTR-004). We normalize the range with semver
// before judging it, rather than pattern-matching the input spelling: many strings
// normalize to "any version" ('', '*', 'x', '>=0.0.0', and others), and checking the
// normalized form catches all of them instead of an incomplete enumeration of
// spellings. A range that constrains nothing has not declared compatibility — it has
// opted out of the check REQ-CTR-004 requires — so it is refused, the same as a
// range that fails to parse at all. It never silently passes as "no constraint".
export const isContractRangeSatisfied = (range: string): boolean => {
  const normalized = validRange(range);
  if (normalized === null || normalized === '*') return false;
  return satisfies(CONTRACT_VERSION, range);
};

// REQ-CTR-004 requires a manifest to declare a *compatible* range. A range with no
// upper bound (`>=1.0.0`, `*`, `>=0.0.0-0`) declares compatibility with a contract
// major that does not exist yet: the day core ships a breaking 2.0.0, such a range
// still admits it, and the version gate silently stops gating exactly when a breaking
// change makes it matter most. So a legitimate range must be bounded above (owner
// decision 2026-07-18; reading recorded in the SDK contract design §5). The manifest
// schema (`contractRangeSchema`) delegates to this predicate to make an unbounded
// range unrepresentable at authoring — that is the single home of the invariant, so
// `isContractRangeSatisfied` below is left unchanged.
//
// "Bounded above" is judged by probing an unreachable major rather than parsing the
// range's comparators: contract majors advance deliberately and slowly (ADR-002) and
// will never approach this sentinel, so any range that still admits it has, in
// practice, no ceiling. Using semver's own engine (as `isContractRangeSatisfied`
// does) handles carets, tildes, x-ranges, hyphen and OR ranges uniformly, without an
// incomplete enumeration of spellings.
const UNREACHABLE_CONTRACT_MAJOR = '999999.0.0';

export const admitsUnboundedContractMajor = (range: string): boolean => {
  // A malformed range admits no version at all — validity is a separate check
  // (`contractRangeSchema` refuses it with its own message). Not "unbounded".
  if (validRange(range) === null) return false;
  return satisfies(UNREACHABLE_CONTRACT_MAJOR, range);
};

// Exported so the registration service in the later core plan cannot express this
// check any other way than with the typed error the norm requires.
export const assertContractRangeSatisfied = (range: string): void => {
  if (!isContractRangeSatisfied(range)) {
    throw new ContractError(
      'CONTRACT_VERSION_INCOMPATIBLE',
      `manifest requires contract range "${range}", core provides ${CONTRACT_VERSION}`,
    );
  }
};
