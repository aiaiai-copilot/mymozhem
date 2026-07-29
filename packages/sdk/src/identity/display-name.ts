import { z } from 'zod';

// Guest display name (REQ-ID-003): trimmed, 1..40 chars. PII-adjacent: it lives on the
// Identity row only and never enters event-log payloads (REQ-SEC-009).
export const DISPLAY_NAME_MAX_LENGTH = 40;
export const displayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH);
export type DisplayName = z.infer<typeof displayNameSchema>;
