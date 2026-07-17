import { z } from 'zod';

// Schemas an app may legally author: everything here survives conversion intact.
export const representableSchemas: { name: string; schema: z.ZodType }[] = [
  { name: 'string bounds and regex', schema: z.object({ nick: z.string().min(1).max(32), code: z.string().regex(/^[A-Z]+$/) }) },
  { name: 'integer bounds', schema: z.object({ choice: z.number().int().min(0).max(3) }) },
  { name: 'enum and optional', schema: z.object({ kind: z.enum(['a', 'b']), note: z.string().optional() }) },
  { name: 'nested object and array', schema: z.object({ rounds: z.array(z.object({ id: z.string() })) }) },
  { name: 'visibility annotation', schema: z.object({ title: z.string().meta({ 'x-visibility': 'public' }) }) },
  { name: 'string .length() (fixed-length code, e.g. a room code)', schema: z.object({ code: z.string().length(6) }) },
  { name: 'array .length() (fixed-size answer array)', schema: z.object({ answers: z.array(z.string()).length(3) }) },
];

// Schemas that must be refused: each would either vanish silently or fail to convert.
export const unrepresentableSchemas: { name: string; schema: z.ZodType }[] = [
  { name: 'top-level .refine()', schema: z.object({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b) },
  { name: 'nested .refine()', schema: z.object({ inner: z.object({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b) }) },
  { name: '.refine() inside an array', schema: z.object({ xs: z.array(z.string().refine((s) => s.length > 2)) }) },
  { name: '.superRefine()', schema: z.object({ s: z.string() }).superRefine(() => {}) },
  { name: 'z.date()', schema: z.object({ at: z.date() }) },
  { name: 'z.bigint()', schema: z.object({ n: z.bigint() }) },
  { name: '.transform()', schema: z.object({ s: z.string().transform((s) => s.length) }) },
  { name: 'string .trim() (overwrite check, dropped silently)', schema: z.object({ s: z.string().trim().min(1) }) },
  { name: 'string .toLowerCase() (overwrite check, dropped silently)', schema: z.object({ s: z.string().toLowerCase() }) },
];
