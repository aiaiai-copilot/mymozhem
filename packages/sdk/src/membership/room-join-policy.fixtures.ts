import type { RoomJoinPolicy } from './room-join-policy';

export const validJoinPolicies: RoomJoinPolicy[] = ['guests', 'registered', 'invite_only'];

// Wrong case, unknown values, empty, non-strings — all rejected.
export const invalidJoinPolicies: unknown[] = ['GUESTS', 'Guests', 'public', '', null, 42];
