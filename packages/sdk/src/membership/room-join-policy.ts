import { z } from 'zod';

// REQ-ID-002: join policy is a room attribute, default 'guests' (ADR-004). Values are
// the lowercase spec strings; the DB enum maps to them via @map (design §2).
export const ROOM_JOIN_POLICIES = ['guests', 'registered', 'invite_only'] as const;
export const roomJoinPolicySchema = z.enum(ROOM_JOIN_POLICIES);
export type RoomJoinPolicy = z.infer<typeof roomJoinPolicySchema>;
