export const validDisplayNames: string[] = ['Саша', 'A', '  Alex  '];

// Empty, whitespace-only (trims to empty), over the cap, non-strings — all rejected.
export const invalidDisplayNames: unknown[] = ['', '   ', 'x'.repeat(41), null, 42];
