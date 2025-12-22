# MyMozhem Lottery

Interactive lottery platform for events with real-time synchronization.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint
```

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

## Configuration

1. Copy `.env.example` to `.env`
2. Add your Supabase credentials:
   ```
   VITE_SUPABASE_URL=your-project-url
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

## Documentation

- [Product Requirements Document](docs/mymozhem-lottery-prd.md)
- [Claude Code Instructions](CLAUDE.md)

## Tech Stack

- **Frontend**: Vite + React 18 + TypeScript
- **UI**: shadcn/ui + Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Realtime)
- **Deployment**: Vercel

## Features

- Room creation and management
- Real-time participant synchronization
- Prize management
- Random winner selection
- Animated winner reveal
- QR code generation for easy joining
- New Year theme (prototype)

## Current Status

**Version**: 0.1.0 (Prototype)
**Phase**: Foundation complete, ready for feature implementation

## Next Steps

1. Implement Supabase repository methods
2. Create database schema and migrations
3. Build room creation flow
4. Add prize and participant management UI
5. Implement drawing logic and visualization
6. Add New Year theme assets and animations

## Development

See [CLAUDE.md](CLAUDE.md) for development guidelines and specialized agent usage.
