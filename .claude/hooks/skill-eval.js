#!/usr/bin/env node

/**
 * UserPromptSubmit hook: Forces Claude to evaluate skills and subagents
 * before proceeding with implementation.
 * 
 * This addresses the ~20% skill activation problem, boosting it to ~84%.
 */

// Consume stdin (required by hook protocol)
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const instruction = `
═══════════════════════════════════════════════════════════════════════════════
⚠️  MANDATORY: SUBAGENT & SKILL EVALUATION — DO NOT SKIP
═══════════════════════════════════════════════════════════════════════════════

STEP 1 — EVALUATE SUBAGENTS (check each one):

| Subagent           | Match? | Reason                                    |
|--------------------|--------|-------------------------------------------|
| component-creator  | ?      | React components, UI, forms, modals       |
| supabase-schema    | ?      | Database, migrations, RLS, Supabase       |
| i18n-manager       | ?      | Translations, UI strings, i18n            |
| test-writer        | ?      | Tests, specs, coverage                    |
| theme-designer     | ?      | Themes, colors, CSS, animations           |

STEP 2 — DELEGATE OR PROCEED:
• If ANY subagent matches → Use Task tool to delegate NOW
• If NONE match → Proceed yourself

STEP 3 — EVALUATE SKILLS:
• react-components → React/shadcn/UI patterns
• supabase-realtime → Database subscriptions, live updates
• plugin-architecture → Creating plugins (games, visualizations, themes)

STEP 4 — LOAD SKILLS:
• If skill is relevant → Read its SKILL.md before implementing

═══════════════════════════════════════════════════════════════════════════════
CRITICAL: Show your evaluation table. Do NOT skip to implementation.
═══════════════════════════════════════════════════════════════════════════════
`;

  process.stdout.write(instruction.trim());
});
