---
description: Implement a new feature following project conventions. Evaluates and delegates to appropriate subagents. Use with feature description as argument.
---

# Add Feature: $ARGUMENTS

Implement the feature following project conventions.

## Before Starting

1. Check `docs/PRD.md` for feature requirements
2. Evaluate which subagents to delegate to

## Subagent Delegation

| If feature involves... | Delegate to |
|------------------------|-------------|
| UI components, forms | component-creator |
| Database changes | supabase-schema |
| New UI text | i18n-manager |
| Tests | test-writer |
| Visual styling | theme-designer |

## Process

1. Break down feature into tasks
2. Delegate to appropriate subagents
3. Integrate pieces together
4. Verify with tests
5. Update documentation if needed

## Checklist

- [ ] PRD requirements met
- [ ] All strings in i18n (no hardcoded Cyrillic)
- [ ] Components follow project patterns
- [ ] Database migrations created (if applicable)
- [ ] Tests written
- [ ] Mobile responsive
- [ ] Accessibility checked

## Output

Summary of what was implemented and files changed.
