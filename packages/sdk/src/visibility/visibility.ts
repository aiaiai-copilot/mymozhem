import { z } from 'zod';

// Visibility levels of room state, log events and appSettings (REQ-CORE-005).
export const VISIBILITY_LEVELS = ['public', 'organizer', 'module-private'] as const;
export const visibilitySchema = z.enum(VISIBILITY_LEVELS);
export type Visibility = z.infer<typeof visibilitySchema>;

// Exposure lattice: public > organizer > module-private. Written down explicitly
// because REQ-CTR-009 has nothing to enforce without an order (design §4.5).
const EXPOSURE_RANK: Record<Visibility, number> = {
  public: 2,
  organizer: 1,
  'module-private': 0,
};

export const exposureRank = (level: Visibility): number => EXPOSURE_RANK[level];

// A declared level is a CEILING: REQ-CTR-009 calls it the maximum allowed level and
// rejects an event whose actual visibility is weaker (= more exposed) than declared.
export const isWithinCeiling = (actual: Visibility, ceiling: Visibility): boolean =>
  EXPOSURE_RANK[actual] <= EXPOSURE_RANK[ceiling];

// Fail-safe default for an unannotated appSettings property (REQ-CORE-008, ADR-008):
// to leak, an author must write `public` explicitly — forgetting closes, never opens.
export const DEFAULT_VISIBILITY: Visibility = 'module-private';
