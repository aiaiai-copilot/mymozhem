---
description: Review recent changes against project standards. Checks code quality, i18n compliance, architecture, and testing.
---

# Code Review

Review recent changes against project standards.

## Checks

### Code Quality
- [ ] No `any` types
- [ ] Named exports (not default)
- [ ] Props interfaces defined and exported
- [ ] Error handling present
- [ ] No console.log in production code

### i18n Compliance
- [ ] No hardcoded Cyrillic in components
- [ ] All user-visible strings use `t()`
- [ ] Translation keys follow naming convention

### Architecture
- [ ] Components in correct directories
- [ ] Data access through repository layer
- [ ] Plugins follow interface contracts
- [ ] No business logic in components

### Styling
- [ ] Mobile-first approach
- [ ] Using Tailwind utilities
- [ ] Using shadcn/ui components where applicable
- [ ] Theme CSS variables used (not hardcoded colors)

### Testing
- [ ] New features have tests
- [ ] Tests use accessible queries
- [ ] No implementation details tested

### Accessibility
- [ ] Interactive elements have names
- [ ] Form inputs have labels
- [ ] Color contrast sufficient

## Output

List of issues found with:
- File path and line number
- Issue description
- Suggested fix

If no issues: "✅ Code review passed"
