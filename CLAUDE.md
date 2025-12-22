# MyMozhem — Claude Code Instructions

## Project Overview

MyMozhem is a platform for interactive entertainment at events. The first module is a lottery/raffle system with real-time synchronization.

**Stack:** Vite + React + TypeScript + shadcn/ui + Tailwind CSS + Supabase (with Realtime)

**Deploy:** Vercel

## Documentation

- `docs/PRD.md` — Product Requirements Document (source of truth)

## Architecture Principles

1. **Plugin-based extensibility** — Game types, visualizations, and themes are pluggable modules
2. **Repository pattern** — Data access abstracted from UI components
3. **i18n-ready** — All strings externalized, Russian only in prototype
4. **Mobile-first** — Responsive design, smartphone as primary device

## Project Structure

```
src/
├── components/
│   ├── ui/              # shadcn/ui components
│   ├── lottery/         # Lottery-specific components
│   ├── admin/           # Organizer dashboard
│   └── room/            # Participant view
├── hooks/               # React hooks
├── lib/                 # Utilities (supabase client, etc.)
├── plugins/
│   ├── games/           # Game type implementations
│   ├── visualizations/  # Winner reveal animations
│   └── themes/          # Visual themes
├── repositories/        # Data access layer
├── i18n/                # Translations
├── types/               # TypeScript types
└── pages/               # Route components
```

## Commands

- `pnpm dev` — Start dev server
- `pnpm build` — Production build
- `pnpm test` — Run tests
- `pnpm lint` — Lint code

## Code Style

- Functional components with hooks
- Named exports (not default)
- Explicit TypeScript types (no `any`)
- Use `cn()` helper for conditional classes
- Prefer composition over inheritance

---

## ⚠️ MANDATORY: Subagent & Skill Evaluation

**BEFORE implementing any task, you MUST evaluate subagents and skills.**

### Available Subagents

| Agent | Use For | Trigger Phrases |
|-------|---------|-----------------|
| `component-creator` | Creating React components, forms, modals | "create component", "add button", "build form" |
| `supabase-schema` | Database schema, migrations, RLS policies | "database", "table", "migration", "Supabase" |
| `i18n-manager` | Adding/updating translations | "translation", "i18n", "text", "string" |
| `test-writer` | Writing tests | "test", "spec", "coverage" |
| `theme-designer` | Visual themes, colors, animations | "theme", "design", "colors", "animation" |

### Available Skills

| Skill | Auto-activates When |
|-------|---------------------|
| `react-components` | Working with React, shadcn/ui, forms |
| `supabase-realtime` | Database subscriptions, live updates |
| `plugin-architecture` | Creating games, visualizations, themes |

### Delegation Rules

1. **If task matches a subagent** → Delegate using Task tool
2. **If task needs skill context** → Read the skill's SKILL.md first
3. **Complex tasks** → Break down and delegate parts to appropriate subagents

---

## Critical Rules

1. **Read PRD first** — Before implementing features, check `docs/PRD.md`
2. **ALWAYS evaluate subagents** — Check the table above before coding
3. **No hardcoded strings** — All UI text goes through i18n
4. **Test coverage** — New features need tests
5. **Mobile-first** — Test responsive behavior

## MCP Servers

Project has 4 MCP servers configured:

### Included in `.mcp.json` (auto-loaded)

| Server | Purpose | Usage |
|--------|---------|-------|
| **supabase** | Database management | `/mcp` to authenticate, then create tables, run SQL, manage RLS |
| **playwright** | Browser automation, E2E testing | "use playwright mcp to..." for UI testing |
| **context7** | Up-to-date library docs | Add "use context7" to get current docs for shadcn, Supabase, etc. |

### First run

```bash
# 1. Start Claude Code
claude

# 2. Authenticate MCP servers
/mcp

# 3. Supabase will open browser for OAuth
# 4. Other servers start automatically
```

**Security:** MCP is for development only. Never connect to production data.

---

## Metrics & Logging

Hooks log subagent calls and skill reads for debugging:

| Log File | Content |
|----------|---------|
| `.claude/logs/subagents.jsonl` | Every subagent invocation (timestamp, name, status) |
| `.claude/logs/skills.jsonl` | Every skill file read (timestamp, skill name) |

**View logs:**
```bash
# Recent subagent calls
tail -20 .claude/logs/subagents.jsonl | jq .

# Recent skill reads  
tail -20 .claude/logs/skills.jsonl | jq .

# Count subagent usage
cat .claude/logs/subagents.jsonl | jq -r .agent | sort | uniq -c | sort -rn
```

---

## Current Phase

**Prototype (v0.1)** — Focus on core lottery flow:
- Room creation
- Participant registration
- Prize management
- Real-time drawing
- New Year theme
